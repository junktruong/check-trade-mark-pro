import { NextResponse } from "next/server";
import crypto from "crypto";
import { connectMongo } from "@/lib/mongo";
import { AllowWord, BlockWord } from "@/models/Words";
import { PrecheckCache } from "@/models/PrecheckCache";
import { callTMHunt } from "@/lib/tmhunt";

export const runtime = "nodejs";

function norm(s: any) {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}
function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}
function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

function pickLiveMarks(tm: any): string[] {
  // ưu tiên tm.liveMarks nếu lib đã normalize sẵn
  if (Array.isArray(tm?.liveMarks)) {
    return uniq(
      tm.liveMarks
        .map((x: any) => {
          if (typeof x === "string") return x;
          // fallback nếu tmhunt trả mảng: [serial, wordmark, LIVE/DEAD, ...]
          return x?.[1] ?? x?.wordmark ?? x?.mark ?? "";
        })
        .map(norm)
        .filter(Boolean)
    );
  }
  // fallback “cố cứu” nếu response shape khác
  const arr = tm?.marks || tm?.results || [];
  if (!Array.isArray(arr)) return [];
  return uniq(
    arr
      .map((x: any) => x?.wordmark ?? x?.mark ?? x?.[1] ?? "")
      .map(norm)
      .filter(Boolean)
  );
}

async function validateSynonymWithTMHunt(syn: string, allow: string[]) {
  const key = "TMHUNT_SYNONYM|" + syn;
  const hash = sha256(key);

  // cache 30 ngày (dùng chung PrecheckCache để tiện clear)
  const ttlMs = 30 * 24 * 60 * 60 * 1000;

  const cached = await PrecheckCache.findOne({ hash }).lean();
  if (cached && Date.now() - new Date(cached.ts).getTime() <= ttlMs) {
    const ok = !!cached.ok;
    const liveMarks = (cached.details?.liveMarks || []) as string[];
    return { ok, liveMarks, cache: "HIT" as const };
  }

  const tm = await callTMHunt(syn);
  const liveMarks = pickLiveMarks(tm);

  // loại bỏ allowlist (safe words)
  const filtered = liveMarks.filter((m) => !allow.includes(m));

  const ok = filtered.length === 0;

  await PrecheckCache.updateOne(
    { hash },
    {
      $set: {
        ok,
        step: "TMHUNT_SYNONYM",
        details: { synonym: syn, liveMarks: filtered },
        ts: new Date(),
      },
    },
    { upsert: true }
  );

  return { ok, liveMarks: filtered, cache: "MISS" as const };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const value = norm(url.searchParams.get("value"));
    if (!value) return NextResponse.json({ ok: false, error: "Missing value" }, { status: 400 });

    await connectMongo();
    const doc = await BlockWord.findOne({ value }).lean();
    if (!doc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    return NextResponse.json({
      ok: true,
      word: {
        value: doc.value,
        source: doc.source || "manual",
        synonyms: Array.isArray(doc.synonyms) ? doc.synonyms : [],
        hitCount: doc.hitCount ?? 0,
        lastSeenAt: doc.lastSeenAt ?? null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const value = norm(body?.value);
    const add = Array.isArray(body?.add) ? body.add.map(norm).filter(Boolean) : [];
    const remove = Array.isArray(body?.remove) ? body.remove.map(norm).filter(Boolean) : [];

    if (!value) return NextResponse.json({ ok: false, error: "Missing value" }, { status: 400 });
    if (!add.length && !remove.length) {
      return NextResponse.json({ ok: false, error: "Nothing to update" }, { status: 400 });
    }

    await connectMongo();

    // allowlist để lọc “safe words” khi TMHunt trả LIVE cho từ quá chung
    const allow = (await AllowWord.find({}).lean())
      .map((x: any) => norm(x.value))
      .filter(Boolean);

    // ===== REMOVE synonyms =====
    if (remove.length) {
      await BlockWord.updateOne({ value }, { $pull: { synonyms: { $in: remove } } });
    }

    // ===== ADD synonyms (must pass TMHunt) =====
    const rejected: Array<{ value: string; reason: string; liveMarks?: string[] }> = [];
    const accepted: string[] = [];

    if (add.length) {
      // validate từng synonym
      for (const syn of add) {
        // nếu synonym nằm trong allowlist thì bỏ qua check cho nhanh
        if (allow.includes(syn)) {
          accepted.push(syn);
          continue;
        }

        const v = await validateSynonymWithTMHunt(syn, allow);
        if (!v.ok) {
          rejected.push({ value: syn, reason: "tmhunt_live", liveMarks: v.liveMarks });
        } else {
          accepted.push(syn);
        }
      }

      if (accepted.length) {
        await BlockWord.updateOne(
          { value },
          { $addToSet: { synonyms: { $each: uniq(accepted) } } }
        );
      }
    }

    const doc = await BlockWord.findOne({ value }).lean();

    return NextResponse.json({
      ok: true,
      accepted,
      rejected,
      word: {
        value: doc?.value,
        source: doc?.source || "manual",
        synonyms: Array.isArray(doc?.synonyms) ? doc.synonyms : [],
        hitCount: doc?.hitCount ?? 0,
        lastSeenAt: doc?.lastSeenAt ?? null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}
