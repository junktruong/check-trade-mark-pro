import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { AllowWord, WarningWord, BlockWord, Word } from "@/models/Words";

function norm(s: any) {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function pickModel(type: string) {
  if (type === "allow") return AllowWord;
  if (type === "warning") return WarningWord;
  if (type === "block") return BlockWord;
  return null;
}

export async function GET() {
  await connectMongo();

  const [allow, warning, block] = await Promise.all([
    AllowWord.find({}, { value: 1 }).sort({ value: 1 }).lean(),
    WarningWord.find({}, { value: 1 }).sort({ value: 1 }).lean(),
    BlockWord.find({}, { value: 1 }).sort({ value: 1 }).lean(),
  ]);

  return NextResponse.json({
    ok: true,
    allow: allow.map((x: any) => x.value),
    warning: warning.map((x: any) => x.value),
    block: block.map((x: any) => x.value),
  });
}

export async function POST(req: Request) {
  await connectMongo();
  const body = await req.json().catch(() => ({}));

  const type = String(body?.type || body?.kind || "").toLowerCase(); // allow|warning|block
  const value = norm(body?.value);
  const source = String(body?.source || "manual");

  const Model = pickModel(type);
  if (!Model) return NextResponse.json({ ok: false, error: "Invalid type" }, { status: 400 });
  if (!value) return NextResponse.json({ ok: false, error: "value is empty" }, { status: 400 });

  // ✅ upsert 1 record trong collection "words" và đổi kind theo Model
  // discriminatorKey là "kind" => giá trị sẽ là "AllowWord"/"WarningWord"/"BlockWord"
  const kind =
  type === "allow" ? "AllowWord" : type === "warning" ? "WarningWord" : "BlockWord";

await Word.updateOne(
  { value },
  {
    $set: { kind, source },
    $setOnInsert: {
      value,
      synonyms: [],
      hitCount: 0,
      lastSeenAt: null,
    },
  },
  {
    upsert: true,
    strict: false,          // ✅ extra safety: don't strip fields
    setDefaultsOnInsert: true,
  }
);

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  await connectMongo();
  const { searchParams } = new URL(req.url);

  const type = String(searchParams.get("type") || "").toLowerCase();
  const value = norm(searchParams.get("value"));

  const Model = pickModel(type);
  if (!Model) return NextResponse.json({ ok: false, error: "Invalid type" }, { status: 400 });
  if (!value) return NextResponse.json({ ok: false, error: "value is empty" }, { status: 400 });

  await Model.deleteOne({ value });
  return NextResponse.json({ ok: true });
}
