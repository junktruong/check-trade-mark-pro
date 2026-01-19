import { NextResponse } from "next/server";
import { callTMHunt } from "@/lib/tmhunt";
import { buildText, norm, uniq } from "../rows";
import { extractLiveTextMarks, loadWordData } from "../words";

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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const row = body?.row || {};
    const options = body?.options || {};
    const enableTm = !!options.enableTmCheck;

    if (!enableTm) {
      return NextResponse.json({ ok: true, status: "PASS" }, { headers: cors(req) });
    }

    const normalizedText = norm(buildText(row));
    if (!normalizedText) {
      return NextResponse.json({ ok: false, error: "row text is empty" }, { status: 400, headers: cors(req) });
    }

    const { allowSet } = await loadWordData();
    const tm = await callTMHunt(normalizedText);
    const liveTextMarks = uniq(extractLiveTextMarks(tm));
    const filtered = liveTextMarks.filter((m) => !allowSet.has(m));

    if (filtered.length) {
      return NextResponse.json(
        {
          ok: false,
          status: "BLOCK",
          reason: "tmhunt",
          liveMarks: filtered,
          message: "TMHunt found LIVE TEXT marks. Must replace/remove.",
        },
        { headers: cors(req) }
      );
    }

    return NextResponse.json({ ok: true, status: "PASS" }, { headers: cors(req) });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500, headers: cors(req) }
    );
  }
}
