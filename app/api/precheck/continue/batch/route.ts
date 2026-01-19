import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { PrecheckRow } from "@/models/PrecheckRow";
import { buildRowHash } from "../../sheet/rows";

export const runtime = "nodejs";

const CONTINUABLE_STAGES = new Set(["warningWords", "geminiPolicy", "youthImage"]);

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

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const fitType = String(body?.fitType || "none").trim().toLowerCase();
    const options = body?.options || {};
    const enableText = !!options.enableTextCheck;
    const enablePolicy = !!options.enablePolicyCheck;
    const enableTm = !!options.enableTmCheck;
    const continuedStagesInput = Array.isArray(body?.continuedStages)
      ? body.continuedStages
      : Array.isArray(body?.stages)
      ? body.stages
      : [];

    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "rows is required" }, { status: 400, headers: cors(req) });
    }

    const names = rows.map((row: any) => String(row?.name || "").trim()).filter(Boolean);
    if (!names.length) {
      return NextResponse.json({ ok: false, error: "rows[].name is required" }, { status: 400, headers: cors(req) });
    }

    await connectMongo();
    const existingRows = await PrecheckRow.find({ name: { $in: names } }).lean();
    const existingByName = new Map(existingRows.map((doc: any) => [String(doc?.name || "").trim(), doc]));

    const updates = rows
      .map((row: any) => {
        const name = String(row?.name || "").trim();
        if (!name) return null;

        const rowHash = buildRowHash({ row, fitType, enableText, enablePolicy, enableTm });
        const existing = existingByName.get(name);
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

        return {
          updateOne: {
            filter: { name },
            update: {
              $set: {
                name,
                rowHash,
                status: "WARN",
                continued: continuedStages.length > 0,
                continuedStages,
                lastStatusByStage,
                data: row,
                issues: null,
                fitType,
                options: { enableText, enablePolicy, enableTm },
                updatedAt: new Date(),
              },
            },
            upsert: true,
          },
        };
      })
      .filter(Boolean);

    if (updates.length) {
      await PrecheckRow.bulkWrite(updates as any[], { ordered: false });
    }

    return NextResponse.json({ ok: true, updated: updates.length }, { headers: cors(req) });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500, headers: cors(req) }
    );
  }
}
