import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { PrecheckCache } from "@/models/PrecheckCache";

export const runtime = "nodejs";

export async function POST() {
  try {
    await connectMongo();
    const r = await PrecheckCache.deleteMany({});
    return NextResponse.json({ ok: true, deleted: r.deletedCount ?? 0 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}
