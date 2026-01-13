import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { AllowWord, BlockWord } from "@/models/Words";
import { callTMHunt } from "@/lib/tmhunt";

export async function POST(req: Request) {
  try {
    const { title, bullet1, bullet2, description } = await req.json();
    await connectMongo();

    const text = [title, bullet1, bullet2, description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    // 1️⃣ lấy danh sách allow / deny
    const allow = (await AllowWord.find({})).map(x => x.value.toLowerCase());
    const deny = (await BlockWord.find({})).map(x => x.value.toLowerCase());

    // 2️⃣ check từ bị cấm (deny list)
    const denyHit = deny.filter(w => text.includes(w));

    if (denyHit.length > 0) {
      return NextResponse.json({
        ok: false,
        reason: "blocklist",
        blockedWords: denyHit
      });
    }

    // 3️⃣ check TMHunt (nếu không dính blocklist)
    const tm = await callTMHunt(text);
    const liveMarks = tm.liveMarks.map((x:any )  => x.toLowerCase());

    // 4️⃣ loại bỏ các từ cho phép (allowlist)
    const filtered = liveMarks.filter(m => !allow.includes(m));

    if (filtered.length > 0) {
      // ghi log lại mark LIVE cho admin nếu cần
      await BlockWord.updateMany(
        { value: { $in: filtered } },
        { $setOnInsert: { value: filtered, source: "tmhunt" } },
        { upsert: true }
      );

      return NextResponse.json({
        ok: false,
        reason: "tmhunt",
        liveMarks: filtered
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}
