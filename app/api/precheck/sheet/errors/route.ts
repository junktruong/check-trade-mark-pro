import { NextResponse } from "next/server";
import { WarningWord, BlockWord } from "@/models/Words";
import { callTMHunt } from "@/lib/tmhunt";
import { geminiPolicyCheckVi, buildHighlightsByField } from "../gemini";
import {
  buildText,
  cleanRowObject,
  isTrulyEmptyRow,
  isUsableRow,
  looksLikeHeaderRow,
  norm,
  normalizeRows,
  uniq,
} from "../rows";
import { buildSuggestionsByWord, extractLiveTextMarks, loadWordData } from "../words";
import { log } from "console";

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
    log("[precheck/sheet/errors] request:start");
    const body = await req.json().catch(() => ({}));
    const options = body?.options || {};
    const enableText = !!options.enableTextCheck;
    const enablePolicy = !!options.enablePolicyCheck;
    const enableTm = !!options.enableTmCheck;
    const inputRows = Array.isArray(body?.rows) ? body.rows : [];

    log("[precheck/sheet/errors] request:options", {
      enableText,
      enablePolicy,
      enableTm,
      rowsCount: inputRows.length,
    });

    if (!inputRows.length) {
      log("[precheck/sheet/errors] request:invalid", { reason: "rows is empty" });
      return NextResponse.json({ ok: false, error: "rows is empty" }, { status: 400, headers: cors(req) });
    }

    const rawRows = inputRows
      .map(cleanRowObject)
      .filter((r:any) => !isTrulyEmptyRow(r))
      .filter((r:any) => !looksLikeHeaderRow(r))
      .filter((r:any) => isUsableRow(r));

    log("[precheck/sheet/errors] rows:filtered", {
      input: inputRows.length,
      raw: rawRows.length,
    });

    if (!rawRows.length) {
      log("[precheck/sheet/errors] request:invalid", { reason: "rows has no usable items" });
      return NextResponse.json({ ok: false, error: "rows has no usable items" }, { status: 400, headers: cors(req) });
    }

    const rows = normalizeRows(rawRows);
    log("[precheck/sheet/errors] rows:normalized", { count: rows.length });
    const { allowSet, warn, block, warnMap, blockMap } = await loadWordData();
    log("[precheck/sheet/errors] words:loaded", {
      allow: allowSet.size,
      warn: warn.length,
      block: block.length,
    });
    const warnSet = new Set(warn);
    const now = new Date();

    const results: any[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = r?.name || `Row ${i + 1}`;
      const normalizedText = norm(buildText(r));

      let status: "PASS" | "WARN" | "BLOCK" = "PASS";
      const issues: any = {};
      log("[precheck/sheet/errors] row:start", { index: i, name });

      if (enableText) {
        const blockHits = uniq(block.filter((w) => w && normalizedText.includes(w) && !allowSet.has(w)));
        if (blockHits.length) {
          status = "BLOCK";
          issues.block = {
            words: blockHits,
            suggestionsByWord: await buildSuggestionsByWord(blockHits, blockMap, allowSet),
            message: "Replace blocked words using suggested safe alternatives.",
          };

          log("[precheck/sheet/errors] row:blockHits", { index: i, name, count: blockHits.length });

          await BlockWord.updateMany(
            { value: { $in: blockHits } },
            { $set: { lastSeenAt: now }, $inc: { hitCount: 1 } }
          );
        }

        const warnHits = uniq(warn.filter((w) => w && normalizedText.includes(w) && !allowSet.has(w)));
        if (warnHits.length) {
          if (status !== "BLOCK") status = "WARN";
          issues.warningWords = {
            words: warnHits,
            suggestionsByWord: await buildSuggestionsByWord(warnHits, warnMap, allowSet),
            message: "Warning words found. Review before proceeding.",
          };

          log("[precheck/sheet/errors] row:warnHits", { index: i, name, count: warnHits.length });

          await WarningWord.updateMany(
            { value: { $in: warnHits } },
            { $set: { lastSeenAt: now }, $inc: { hitCount: 1 } }
          );
        }
      }

      if (enableTm) {
        try {
          const tm = await callTMHunt(normalizedText);
          const liveTextMarks = uniq(extractLiveTextMarks(tm));
          const filtered = liveTextMarks.filter((m) => !allowSet.has(m) && !warnSet.has(m));

          if (filtered.length) {
            status = "BLOCK";
            issues.tmhunt = {
              liveMarks: filtered,
              message: "TMHunt found LIVE TEXT marks. Must replace/remove.",
            };

            log("[precheck/sheet/errors] row:tmhuntHits", { index: i, name, count: filtered.length });

            await BlockWord.bulkWrite(
              filtered.map((w) => ({
                updateOne: {
                  filter: { value: w },
                  update: {
                    $set: { lastSeenAt: now },
                    $setOnInsert: {
                      value: w,
                      synonyms: [],
                      source: "tmhunt",
                    },
                    $inc: { hitCount: 1 },
                  },
                  upsert: true,
                },
              })),
              { ordered: false }
            );
          }
        } catch (e: any) {
          issues.tmhuntError = { message: "TMHunt error: " + (e?.message || String(e)) };
          log("[precheck/sheet/errors] row:tmhuntError", { index: i, name, error: e?.message || String(e) });
        }
      }

      if (enablePolicy) {
        try {
          const pr = await geminiPolicyCheckVi(r);
          const policyOk = !!pr?.policy_ok;
          if (!policyOk) {
            if (status !== "BLOCK") status = "WARN";
            const policyIssues = Array.isArray(pr?.policy_issues) ? pr.policy_issues : [];
            issues.geminiPolicy = {
              issues: policyIssues,
              highlightsByField: buildHighlightsByField(policyIssues),
              message: "Gemini flagged policy risks (WARNING). Review before proceeding.",
            };

            log("[precheck/sheet/errors] row:policyWarn", { index: i, name, count: policyIssues.length });
          }
        } catch (e: any) {
          if (status !== "BLOCK") status = "WARN";
          issues.geminiPolicy = {
            issues: [],
            message: "Gemini policy check failed (treated as WARNING): " + (e?.message || String(e)),
          };
          log("[precheck/sheet/errors] row:policyError", { index: i, name, error: e?.message || String(e) });
        }
      }

      if (status !== "PASS") {
        results.push({ index: i, name, status, issues });
      }

      log("[precheck/sheet/errors] row:end", { index: i, name, status });
    }

    const summary = {
      total: results.length,
      warn: results.filter((x) => x.status === "WARN").length,
      block: results.filter((x) => x.status === "BLOCK").length,
    };

    log("[precheck/sheet/errors] summary", summary);
    log("[precheck/sheet/errors] results", results);

    return NextResponse.json(
      {
        ok: summary.block === 0 && summary.warn === 0,
        step: "ERROR_REPORT",
        summary,
        results,
      },
      { headers: cors(req) }
    );
  } catch (e: any) {
    log("[precheck/sheet/errors] request:error", { error: e?.message || String(e) });
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500, headers: cors(req) });
  }
}
