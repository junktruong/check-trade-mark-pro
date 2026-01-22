import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { AllowWord, BlockWord, WarningWord } from "@/models/Words";
import { callTMHunt } from "@/lib/tmhunt";

function norm(value: unknown) {
  return String(value ?? "").toLowerCase().trim();
}

function uniq(values: string[]) {
  return Array.from(new Set(values));
}

export async function POST(req: Request) {
  try {
    const { text, title, bullet1, bullet2, description } = await req.json();
    const combined =
      typeof text === "string" && text.trim().length > 0
        ? text
        : [title, bullet1, bullet2, description].filter(Boolean).join(" ");
    const normalized = combined.toLowerCase();

    await connectMongo();

    const allow = (await AllowWord.find({}).lean()).map((x: any) => norm(x.value));
    const block = (await BlockWord.find({}).lean()).map((x: any) => norm(x.value));
    const warning = (await WarningWord.find({}).lean()).map((x: any) => norm(x.value));
    const allowSet = new Set(allow.filter(Boolean));

    const blockedWords = uniq(block.filter((w) => w && normalized.includes(w) && !allowSet.has(w)));
    const warningWords = uniq(warning.filter((w) => w && normalized.includes(w) && !allowSet.has(w)));

    let tmhuntWords: string[] = [];
    if (normalized.trim().length > 0) {
      const tm = await callTMHunt(normalized);
      const liveMarksRaw: string[] = Array.isArray(tm?.liveMarks)
        ? tm.liveMarks.map((x: any) =>
            typeof x === "string" ? x : x?.[1] ?? x?.wordmark ?? x?.mark ?? ""
          )
        : [];
      const liveMarks = uniq(liveMarksRaw.map(norm).filter(Boolean));
      tmhuntWords = liveMarks.filter((m) => !allowSet.has(m));

      if (tmhuntWords.length > 0) {
        await Promise.all(
          tmhuntWords.map((value) =>
            BlockWord.updateOne(
              { value },
              {
                $setOnInsert: {
                  kind: "BlockWord",
                  value,
                  source: "tmhunt",
                },
              },
              { upsert: true }
            )
          )
        );
      }
    }

    const allBlocked = uniq([...blockedWords, ...tmhuntWords]);

    let status: "safe" | "warning" | "block" = "safe";
    if (allBlocked.length > 0) {
      status = "block";
    } else if (warningWords.length > 0) {
      status = "warning";
    }

    return NextResponse.json({
      status,
      warningWords,
      blockedWords: allBlocked,
      tmhuntWords,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
