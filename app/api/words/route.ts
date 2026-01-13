import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { AllowWord, BlockWord } from "@/models/Words";

export async function GET() {
  await connectMongo();
  const allow = (await AllowWord.find({})).map(x => x.value);
  const block = (await BlockWord.find({})).map(x => x.value);
  return NextResponse.json({ allow, block });
}

export async function POST(req: Request) {
  const { type, value } = await req.json();
  await connectMongo();
  if (type === "allow") await AllowWord.updateOne({ value }, { value }, { upsert: true });
  if (type === "block") await BlockWord.updateOne({ value }, { value }, { upsert: true });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const value = searchParams.get("value");
  await connectMongo();
  if (type === "allow") await AllowWord.deleteOne({ value });
  if (type === "block") await BlockWord.deleteOne({ value });
  return NextResponse.json({ ok: true });
}
