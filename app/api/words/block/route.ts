import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { BlockWord, Word } from "@/models/Words";
import { callTMHunt } from "@/lib/tmhunt";

function norm(s: any) {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}
function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

// ✅ strict: chỉ LIVE + TEXT
function extractLiveTextMarks(tm: any): string[] {
  const src = tm?.liveMarks;
  if (!Array.isArray(src)) return [];

  const out: string[] = [];
  for (const x of src) {
    if (!x) continue;

    // ❌ bỏ string (không có status/type)
    if (typeof x === "string") continue;

    if (Array.isArray(x)) {
      const word = norm(x?.[1] ?? "");
      const status = norm(x?.[2] ?? "");
      const type = norm(x?.[3] ?? x?.[4] ?? "");
      if (word && status === "live" && type === "text") out.push(word);
      continue;
    }

    if (typeof x === "object") {
      const word = norm(x?.[1] ?? x?.wordmark ?? x?.mark ?? x?.trademark ?? x?.text ?? "");
      const status = norm(x?.status ?? x?.liveStatus ?? x?.state ?? x?.[2] ?? "");
      const type = norm(x?.type ?? x?.markType ?? x?.kind ?? x?.[3] ?? x?.[4] ?? "");
      if (word && status === "live" && type === "text") out.push(word);
    }
  }
  return uniq(out).filter(Boolean);
}

export async function GET(req: Request) {
  await connectMongo();
  const { searchParams } = new URL(req.url);
  const value = norm(searchParams.get("value"));

  if (!value) return NextResponse.json({ ok: false, error: "value is empty" }, { status: 400 });

  const word = await BlockWord.findOne({ value }).lean();
  return NextResponse.json({ ok: true, word: word || null });
}

export async function PATCH(req: Request) {
  await connectMongo();
  const body = await req.json().catch(() => ({}));

  const value = norm(body?.value);
  const addRaw = Array.isArray(body?.add) ? body.add : [];
  const removeRaw = Array.isArray(body?.remove) ? body.remove : [];

  if (!value) return NextResponse.json({ ok: false, error: "value is empty" }, { status: 400 });

  const existing = await Word.findOne({ value }).lean();
  if (existing && existing.kind !== "BlockWord") {
    return NextResponse.json({ ok: true, skipped: true, existingKind: existing.kind, word: null });
  }

  const add = uniq(addRaw.map(norm).filter(Boolean)).filter((x) => x !== value);
  const remove = uniq(removeRaw.map(norm).filter(Boolean));

  // remove
  if (remove.length) {
    const w = await BlockWord.findOneAndUpdate(
      { value },
      { $pull: { synonyms: { $in: remove } } },
      { new: true, upsert: true }
    ).lean();
    return NextResponse.json({ ok: true, word: w });
  }

  if (!add.length) return NextResponse.json({ ok: true, accepted: [], rejected: [], word: null });

  // ✅ check TMHunt LIVE+TEXT
  const tm = await callTMHunt(add.join(" "));
  const live = extractLiveTextMarks(tm);
  const liveSet = new Set(live);

  const accepted = add.filter((s) => !liveSet.has(s));
  const rejected = add.filter((s) => liveSet.has(s)).map((s) => ({ value: s, liveMarks: [s] }));

  if (accepted.length) {
    await BlockWord.updateOne(
      { value },
      {
        $setOnInsert: { value, source: "manual" },
        $addToSet: { synonyms: { $each: accepted } },
      },
      { upsert: true }
    );
  }

  const w = await BlockWord.findOne({ value }).lean();
  return NextResponse.json({ ok: true, accepted, rejected, word: w });
}
