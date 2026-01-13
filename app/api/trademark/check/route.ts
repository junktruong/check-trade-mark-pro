import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { AllowWord, BlockWord } from "@/models/Words";
import { callTMHunt } from "@/lib/tmhunt";

function norm(s: any) {
  return String(s ?? "").toLowerCase().trim();
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

export async function POST(req: Request) {
  try {
    const { title, bullet1, bullet2, description } = await req.json();
    await connectMongo();

    const text = [title, bullet1, bullet2, description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    // 1) load allow/block
    const allow = (await AllowWord.find({}).lean()).map((x: any) => norm(x.value));
    const deny = (await BlockWord.find({}).lean()).map((x: any) => norm(x.value));

    // 2) check deny list (blocklist)
    const denyHit = uniq(deny.filter((w : any) => w && text.includes(w)));

    if (denyHit.length > 0) {
      // optional: update stats (nếu muốn)
      await BlockWord.bulkWrite(
        denyHit.map((w) => ({
          updateOne: {
            filter: { value: w },
            update: {
              $set: { source: "manual" },
              $setOnInsert: { value: w, createdAt: new Date() },
              $inc: { hitCount: 1 },
            },
            upsert: true,
          },
        })),
        { ordered: false }
      );

      return NextResponse.json({
        ok: false,
        reason: "blocklist",
        blockedWords: denyHit,
      });
    }

    // 3) call TMHunt
    const tm = await callTMHunt(text);

    // tm.liveMarks có thể là string[] hoặc array dạng phức tạp => normalize kiểu an toàn
    const liveMarksRaw: string[] = Array.isArray(tm?.liveMarks)
      ? tm.liveMarks.map((x: any) => (typeof x === "string" ? x : x?.[1] ?? x?.wordmark ?? x?.mark ?? ""))
      : [];

    const liveMarks = uniq(liveMarksRaw.map(norm).filter(Boolean));

    // 4) filter allowlist
    const filtered = liveMarks.filter((m) => !allow.includes(m));

    if (filtered.length > 0) {
      // ✅ lưu từng từ cấm vào DB (upsert nhiều doc)
      const now = new Date();
      await BlockWord.bulkWrite(
        filtered.map((w) => ({
          updateOne: {
            filter: { value: w },
            update: {
              $setOnInsert: { value: w, source: "tmhunt", createdAt: now },
              $set: { lastSeenAt: now, source: "tmhunt" },
              $inc: { hitCount: 1 },
            },
            upsert: true,
          },
        })),
        { ordered: false }
      );

      return NextResponse.json({
        ok: false,
        reason: "tmhunt",
        liveMarks: filtered,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
