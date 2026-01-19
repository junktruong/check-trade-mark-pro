import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { PrecheckRow } from "@/models/PrecheckRow";
import { buildRowHash } from "../sheet/rows";

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

const CONTINUABLE_STAGES = new Set(["warningWords", "geminiPolicy", "youthImage"]);

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
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
    const continuedStagesInput = Array.isArray(body?.continuedStages)
      ? body.continuedStages
      : Array.isArray(body?.stages)
      ? body.stages
      : [];

    if (!name) {
      return NextResponse.json({ ok: false, error: "row.name is required" }, { status: 400, headers: cors(req) });
    }

    const rowHash = buildRowHash({ row, fitType, enableText, enablePolicy, enableTm });

    await connectMongo();
    const existing = await PrecheckRow.findOne({ name }).lean();
    const cacheMatch = existing?.rowHash === rowHash;
    const previousStages =
      cacheMatch && Array.isArray(existing?.continuedStages) ? existing.continuedStages : [];
    const lastStatusByStage =
      cacheMatch && existing?.lastStatusByStage ? (existing.lastStatusByStage as Record<string, string>) : {};
    const warnStages = Object.entries(lastStatusByStage)
      .filter(([stage, status]) => CONTINUABLE_STAGES.has(stage) && status === "WARN")
      .map(([stage]) => stage);
    const continuedStages = uniq([
      ...previousStages,
      ...warnStages,
      ...continuedStagesInput.map((stage: string) => String(stage)),
    ]);
    await PrecheckRow.updateOne(
      { name },
      {
        $set: {
          name,
          rowHash,
          status: "WARN",
          continued: continuedStages.length > 0,
          continuedStages,
          lastStatusByStage,
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
