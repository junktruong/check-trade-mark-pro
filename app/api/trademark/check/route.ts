import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { AllowWord, BlockWord, WarningWord } from "@/models/Words";
import { callTMHunt } from "@/lib/tmhunt";

function norm(s: any) {
  return String(s ?? "").toLowerCase().trim();
}
function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

export async function POST(req: Request) {
  try {
    const { title, bullet1, bullet2, description, continueTmHunt } = await req.json();
    await connectMongo();

    const text = [title, bullet1, bullet2, description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    // 1) load allow/block/warning
    const allow = (await AllowWord.find({}).lean()).map((x: any) => norm(x.value));
    const deny = (await BlockWord.find({}).lean()).map((x: any) => norm(x.value));
    const warn = (await WarningWord.find({}).lean()).map((x: any) => norm(x.value));
    const allowSet = new Set(allow.filter(Boolean));

    // 2) deny list check
    const denyHit = uniq(deny.filter((w) => w && text.includes(w) && !allowSet.has(w)));

    if (denyHit.length > 0) {
      return NextResponse.json({
        ok: false,
        reason: "blocklist",
        blockedWords: denyHit,
      });
    }

    // 3) warning list check (soft stop)
    const warnHit = uniq(warn.filter((w) => w && text.includes(w) && !allowSet.has(w)));
    if (warnHit.length > 0 && !continueTmHunt) {
      return NextResponse.json({
        ok: false,
        reason: "warning",
        warningWords: warnHit,
        message: "Warning words found. Continue to run TMHunt if acceptable.",
      });
    }

    // 4) TMHunt
    const tm = await callTMHunt(text);

    // normalize liveMarks
    const liveMarksRaw: string[] = Array.isArray(tm?.liveMarks)
      ? tm.liveMarks.map((x: any) => (typeof x === "string" ? x : x?.[1] ?? x?.wordmark ?? x?.mark ?? ""))
      : [];

    const liveMarks = uniq(liveMarksRaw.map(norm).filter(Boolean));

    // 5) filter allowlist
    const filtered = liveMarks.filter((m) => !allowSet.has(m));

    if (filtered.length > 0) {
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
