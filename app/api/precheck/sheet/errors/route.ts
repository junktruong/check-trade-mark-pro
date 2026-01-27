import { NextResponse } from "next/server";
import { WarningWord, BlockWord } from "@/models/Words";
import { callTMHunt } from "@/lib/tmhunt";
import { fetchCsvFromSheet, getRowsFromCsv } from "../csv";
import { geminiPolicyCheckVi, buildHighlightsByField } from "../gemini";
import { parsePrecheckRequest } from "../request";
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
    const { sheetUrl, enableText, enablePolicy, enableTm } = await parsePrecheckRequest(req);

    if (!sheetUrl) {
      return NextResponse.json({ ok: false, error: "sheetUrl is empty" }, { status: 400, headers: cors(req) });
    }

    let csvText = "";
    try {
      csvText = await fetchCsvFromSheet(sheetUrl);
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: e?.message || String(e) },
        { status: e?.message?.startsWith("Fetch CSV failed") ? 502 : 400, headers: cors(req) }
      );
    }

    const rawRows = getRowsFromCsv(csvText)
      .map(cleanRowObject)
      .filter((r) => !isTrulyEmptyRow(r))
      .filter((r) => !looksLikeHeaderRow(r))
      .filter((r) => isUsableRow(r));

    if (!rawRows.length) {
      return NextResponse.json({ ok: false, error: "Google Sheet has no usable rows" }, { status: 400, headers: cors(req) });
    }

    const rows = normalizeRows(rawRows);
    const { allowSet, warn, block, warnMap, blockMap } = await loadWordData();
    const warnSet = new Set(warn);
    const now = new Date();

    const results: any[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = r?.name || `Row ${i + 1}`;
      const normalizedText = norm(buildText(r));

      let status: "PASS" | "WARN" | "BLOCK" = "PASS";
      const issues: any = {};

      if (enableText) {
        const blockHits = uniq(block.filter((w) => w && normalizedText.includes(w) && !allowSet.has(w)));
        if (blockHits.length) {
          status = "BLOCK";
          issues.block = {
            words: blockHits,
            suggestionsByWord: await buildSuggestionsByWord(blockHits, blockMap, allowSet),
            message: "Replace blocked words using suggested safe alternatives.",
          };

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
          }
        } catch (e: any) {
          if (status !== "BLOCK") status = "WARN";
          issues.geminiPolicy = {
            issues: [],
            message: "Gemini policy check failed (treated as WARNING): " + (e?.message || String(e)),
          };
        }
      }

      if (status !== "PASS") {
        results.push({ index: i, name, status, issues });
      }
    }

    const summary = {
      total: results.length,
      warn: results.filter((x) => x.status === "WARN").length,
      block: results.filter((x) => x.status === "BLOCK").length,
    };

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
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500, headers: cors(req) });
  }
}
