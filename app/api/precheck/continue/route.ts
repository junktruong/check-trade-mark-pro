import crypto from "crypto";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { PrecheckRow } from "@/models/PrecheckRow";

export const runtime = "nodejs";

function cors(req: Request) {
  const origin = req.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: cors(req) });
}

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function buildRowHash(params: {
  row: any;
  fitType: string;
  enableText: boolean;
  enablePolicy: boolean;
  enableTm: boolean;
}) {
  const payload = {
    name: String(params.row?.name || ""),
    brand: String(params.row?.brand || ""),
    title: String(params.row?.title || ""),
    bullet1: String(params.row?.bullet1 || ""),
    bullet2: String(params.row?.bullet2 || ""),
    description: String(params.row?.description || ""),
    price: String(params.row?.price || ""),
    image_url: String(params.row?.image_url || ""),
    thumbnail_url: String(params.row?.thumbnail_url || ""),
    fitType: String(params.fitType || "none"),
    flags: {
      enableText: !!params.enableText,
      enablePolicy: !!params.enablePolicy,
      enableTm: !!params.enableTm,
    },
  };
  return sha256(JSON.stringify(payload));
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const row = body?.row || {};
    const name = String(row?.name || "").trim();
    const fitType = String(body?.fitType || "none").trim().toLowerCase();
    const options = body?.options || {};
    const enableText = !!options.enableTextCheck;
    const enablePolicy = !!options.enablePolicyCheck;
    const enableTm = !!options.enableTmCheck;
    const issues = body?.issues || null;

    if (!name) {
      return NextResponse.json({ ok: false, error: "row.name is required" }, { status: 400, headers: cors(req) });
    }

    const rowHash = buildRowHash({ row, fitType, enableText, enablePolicy, enableTm });

    await connectMongo();
    await PrecheckRow.updateOne(
      { name },
      {
        $set: {
          name,
          rowHash,
          status: "WARN",
          continued: true,
          data: row,
          issues,
          fitType,
          options: { enableText, enablePolicy, enableTm },
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    return NextResponse.json({ ok: true }, { headers: cors(req) });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500, headers: cors(req) }
    );
  }
}
