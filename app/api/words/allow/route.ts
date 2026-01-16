import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { AllowWord } from "@/models/Words";

export const runtime = "nodejs";

// ---------- CORS (để extension gọi được) ----------
function cors(req: Request) {
  const origin = req.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: cors(req) });
}

// ---------- utils ----------
function norm(s: any) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// GET /api/words/allow?limit=200
export async function GET(req: Request) {
  try {
    await connectMongo();
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit") || 200)));

    const docs = await AllowWord.find({})
      .sort({ _id: -1 })
      .limit(limit)
      .lean();

    return NextResponse.json(
      { ok: true, words: docs.map((d: any) => ({ value: d.value })) },
      { headers: cors(req) }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500, headers: cors(req) }
    );
  }
}

// POST /api/words/allow   body: { value: "..." }
export async function POST(req: Request) {
  try {
    await connectMongo();

    const body = await req.json().catch(() => ({}));
    const raw = body?.value;
    const value = norm(raw);

    if (!value) {
      return NextResponse.json(
        { ok: false, error: "value is empty" },
        { status: 400, headers: cors(req) }
      );
    }
    if (value.length > 160) {
      return NextResponse.json(
        { ok: false, error: "value is too long (max 160)" },
        { status: 400, headers: cors(req) }
      );
    }

    const now = new Date();

    // upsert allow word
    await AllowWord.updateOne(
      { value },
      { $setOnInsert: { value, createdAt: now }, $set: { lastSeenAt: now } },
      { upsert: true }
    );

    return NextResponse.json({ ok: true, value }, { headers: cors(req) });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500, headers: cors(req) }
    );
  }
}

// DELETE /api/words/allow  body: { value: "..." }
// (hoặc query ?value=...)
export async function DELETE(req: Request) {
  try {
    await connectMongo();

    const url = new URL(req.url);
    const qv = url.searchParams.get("value");

    const body = await req.json().catch(() => ({}));
    const raw = qv ?? body?.value;

    const value = norm(raw);
    if (!value) {
      return NextResponse.json(
        { ok: false, error: "value is empty" },
        { status: 400, headers: cors(req) }
      );
    }

    await AllowWord.deleteOne({ value });

    return NextResponse.json({ ok: true, value }, { headers: cors(req) });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500, headers: cors(req) }
    );
  }
}
