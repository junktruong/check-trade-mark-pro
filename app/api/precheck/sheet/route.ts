import { NextResponse } from "next/server";
import { WarningWord, BlockWord, Word } from "@/models/Words";
import { PrecheckRow } from "@/models/PrecheckRow";
import { callTMHunt } from "@/lib/tmhunt";
import { fetchCsvFromSheet, getRowsFromCsv } from "./csv";
import { geminiPolicyCheck, geminiYouthImageCheck, buildHighlightsByField } from "./gemini";
import { parsePrecheckRequest } from "./request";
import {
  buildRowHash,
  buildRowsByName,
  buildText,
  cleanRowObject,
  isTrulyEmptyRow,
  isUsableRow,
  looksLikeHeaderRow,
  norm,
  normalizeRows,
  uniq,
} from "./rows";
import { buildSuggestionsByWord, extractLiveTextMarks, loadWordData } from "./words";

export const runtime = "nodejs";

// -------------------- CORS --------------------
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

async function loadCachedRows(rowsByName: Map<string, any>) {
  const cachedRows = rowsByName.size
    ? await PrecheckRow.find({ name: { $in: [...rowsByName.keys()] } }).lean()
    : [];
  return new Map<string, any>(cachedRows.map((doc: any) => [String(doc?.name || "").trim(), doc]));
}

// -------------------- Image -> rankedColors (server) --------------------
const COLOR_PALETTE: Record<string, { r: number; g: number; b: number }> = {
  asphalt: { r: 70, g: 74, b: 78 },
  baby_blue: { r: 163, g: 210, b: 245 },
  black: { r: 18, g: 18, b: 18 },
  brown: { r: 92, g: 64, b: 51 },
  cranberry: { r: 146, g: 36, b: 70 },
  dark_heather: { r: 80, g: 82, b: 84 },
  grass: { r: 68, g: 140, b: 48 },
  heather_blue: { r: 120, g: 160, b: 190 },
  heather_grey: { r: 180, g: 180, b: 180 },
  kelly_green: { r: 0, g: 153, b: 85 },
  lemon: { r: 250, g: 230, b: 90 },
  navy: { r: 20, g: 40, b: 90 },
  olive: { r: 85, g: 97, b: 55 },
  orange: { r: 245, g: 140, b: 40 },
  pink: { r: 245, g: 150, b: 190 },
  purple: { r: 120, g: 70, b: 170 },
  red: { r: 210, g: 50, b: 55 },
  royal: { r: 40, g: 80, b: 200 },
  silver: { r: 205, g: 205, b: 205 },
  slate: { r: 90, g: 100, b: 110 },
  white: { r: 250, g: 250, b: 250 },
  dark_green: { r: 35, g: 80, b: 45 },
  burgundy: { r: 110, g: 30, b: 45 },
  golden_yellow: { r: 230, g: 190, b: 30 },
  purple_heather: { r: 150, g: 120, b: 170 },
  red_heather: { r: 190, g: 95, b: 100 },
  olive_heather: { r: 150, g: 155, b: 130 },
  pink_heather: { r: 210, g: 170, b: 185 },
  sapphire: { r: 25, g: 95, b: 160 },
  ivory: { r: 245, g: 240, b: 220 },
  light_beige: { r: 230, g: 215, b: 190 },
  light_pink: { r: 245, g: 200, b: 210 },
  light_purple: { r: 200, g: 175, b: 235 },
  mint_green: { r: 170, g: 230, b: 210 },
};

function srgbToLin(c: number) {
  c = c / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function relLuminance(rgb: { r: number; g: number; b: number }) {
  const r = srgbToLin(rgb.r);
  const g = srgbToLin(rgb.g);
  const b = srgbToLin(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  const L1 = relLuminance(a);
  const L2 = relLuminance(b);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}
function rankColors(d: { r: number; g: number; b: number }) {
  const entries = Object.entries(COLOR_PALETTE).map(([slug, rgb]) => ({
    slug,
    cr: contrastRatio(d, rgb),
    L: relLuminance(rgb),
  }));
  entries.sort((x, y) => y.cr - x.cr);
  return entries.map((e) => ({ slug: e.slug, cr: Number(e.cr.toFixed(4)), L: Number(e.L.toFixed(4)) }));
}

async function computeRankedColorsFromImageUrl(imageUrl: string) {
  if (!imageUrl) return [];
  let sharpMod: any = null;
  try {
    sharpMod = (await import("sharp")).default;
  } catch {
    return [];
  }

  const res = await fetch(imageUrl, { cache: "no-store", redirect: "follow" });
  if (!res.ok) return [];

  const buf = Buffer.from(await res.arrayBuffer());
  const targetW = 64;

  const { data, info } = await sharpMod(buf)
    .ensureAlpha()
    .resize({ width: targetW, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info?.channels || 4;
  let r = 0, g = 0, b = 0, n = 0;

  for (let i = 0; i < data.length; i += channels) {
    const rr = data[i];
    const gg = data[i + 1];
    const bb = data[i + 2];
    const aa = channels >= 4 ? data[i + 3] : 255;
    if (aa < 16) continue;
    r += rr; g += gg; b += bb; n++;
  }

  const dominant = n ? { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) } : { r: 255, g: 255, b: 255 };
  return rankColors(dominant);
}

// -------------------- Main handler --------------------
export async function POST(req: Request) {
  try {
    const { sheetUrl, enableText, enablePolicy, enableTm, fitType, requiresYouthCheck } = await parsePrecheckRequest(req);

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

    // normalize
    const rows = normalizeRows(rawRows);
    const { allowSet, warn, block, warnMap, blockMap } = await loadWordData();

    const now = new Date();

    const results: any[] = [];
    const rowsReady: any[] = [];

    const tmhuntToBlock = new Set<string>();
    const geminiToWarn = new Set<string>();
    const rowsByName = buildRowsByName(rows);
    const cachedByName = await loadCachedRows(rowsByName);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = r?.name || `Row ${i + 1}`;
      const normalizedText = norm(buildText(r));

      let status: "PASS" | "WARN" | "BLOCK" = "PASS";
      const issues: any = {};
      const rowHash = buildRowHash({ row: r, fitType, enableText, enablePolicy, enableTm });
      const cached = cachedByName.get(String(name).trim());

      if (
        cached &&
        cached.rowHash === rowHash &&
        (cached.status === "PASS" || (cached.status === "WARN" && cached.continued))
      ) {
        status = cached.status === "WARN" ? "WARN" : "PASS";
        if (cached.issues) Object.assign(issues, cached.issues);
        results.push({ index: i, name, status, issues, cache: "HIT", continued: !!cached.continued });
        rowsReady.push({
          ...r,
          rankedColors: [],
          status,
          issues,
          cache: "HIT",
          continued: !!cached.continued,
        });
        continue;
      }

      // 0) Youth/Girl image check (WARNING)
      if (requiresYouthCheck && r?.image_url) {
        try {
          const res = await geminiYouthImageCheck(String(r.image_url), fitType);
          if (!res?.youth_ok) {
            status = "WARN";
            issues.youthImage = {
              issues: Array.isArray(res?.issues) ? res.issues : [],
              message: "Design may not be suitable for minors. Review before continuing.",
            };
          }
        } catch (e: any) {
          status = "WARN";
          issues.youthImage = {
            issues: [],
            message: "Youth image check failed (treated as WARNING): " + (e?.message || String(e)),
          };
        }
      }

      // 1) Block words (hard stop)
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

        // 2) Warning words (soft stop)
        const warnHits = uniq(warn.filter((w) => w && normalizedText.includes(w) && !allowSet.has(w)));
        if (warnHits.length) {
          if (status !== "BLOCK") status = "WARN";
          issues.warningWords = {
            words: warnHits,
            suggestionsByWord: await buildSuggestionsByWord(warnHits, warnMap, allowSet),
            message: "Warning words found. Review and Continue if acceptable.",
          };

          await WarningWord.updateMany(
            { value: { $in: warnHits } },
            { $set: { lastSeenAt: now }, $inc: { hitCount: 1 } }
          );
        }
      }

      // 2) TMHunt => BLOCK + auto-save BlockWord
      if (enableTm && status !== "BLOCK") {
        try {
          const tm = await callTMHunt(normalizedText);
          const liveTextMarks = uniq(extractLiveTextMarks(tm));
          const filtered = liveTextMarks.filter((m) => !allowSet.has(m));

          if (filtered.length) {
            status = "BLOCK";
            issues.tmhunt = {
              liveMarks: filtered,
              message: "TMHunt found LIVE TEXT marks. Must replace/remove.",
            };
            filtered.forEach((w) => tmhuntToBlock.add(w));
          }
        } catch (e: any) {
          // TMHunt lỗi thì không tự block, chỉ note
          issues.tmhuntError = { message: "TMHunt error: " + (e?.message || String(e)) };
        }
      }

      // 3) Gemini policy => ALWAYS WARNING
      if (enablePolicy && status !== "BLOCK") {
        try {
          const pr = await geminiPolicyCheck(r);
          const policyOk = !!pr?.policy_ok;
          if (!policyOk) {
            status = "WARN";

            const policyIssues = Array.isArray(pr?.policy_issues) ? pr.policy_issues : [];
            issues.geminiPolicy = {
              issues: policyIssues,
              highlightsByField: buildHighlightsByField(policyIssues),
              message: "Gemini flagged policy risks (WARNING). Review and Continue if acceptable.",
            };

            // ✅ auto-save to WarningWord (terms preferred, fallback evidence)
            for (const it of policyIssues) {
              const terms = Array.isArray(it?.terms) ? it.terms : [];
              const ev = Array.isArray(it?.evidence) ? it.evidence : [];
              const arr = (terms.length ? terms : ev).map((x: any) => norm(String(x))).filter(Boolean);
              for (const t of arr) {
                if (t && t.length <= 160 && !allowSet.has(t)) geminiToWarn.add(t);
              }
            }
          }
        } catch (e: any) {
          status = "WARN";
          issues.geminiPolicy = {
            issues: [],
            message: "Gemini policy check failed (treated as WARNING): " + (e?.message || String(e)),
          };
        }
      }

      results.push({ index: i, name, status, issues });

      // only prepare rowsReady if NOT BLOCK
      if (status !== "BLOCK") {
        let rankedColors: any[] = [];
        try {
          rankedColors = await computeRankedColorsFromImageUrl(String(r.image_url || "").trim());
        } catch {
          rankedColors = [];
        }
        rowsReady.push({ ...r, rankedColors, status, issues, continued: false });
      }

      if (status === "PASS") {
        await PrecheckRow.updateOne(
          { name },
          {
            $set: {
              name,
              rowHash,
              status: "PASS",
              continued: false,
              data: r,
              issues: null,
              fitType,
              options: { enableText, enablePolicy, enableTm },
              updatedAt: now,
            },
          },
          { upsert: true }
        );
      }
    }

    // ✅ bulk save TMHunt -> BlockWord
    if (tmhuntToBlock.size) {
      const arr = [...tmhuntToBlock];
      await Word.bulkWrite(
        arr.map((w) => ({
          updateOne: {
            filter: { value: w },
            update: {
              $set: { kind: "BlockWord", lastSeenAt: now },
              $setOnInsert: { value: w, source: "tmhunt", synonyms: [], hitCount: 0 },
              $inc: { hitCount: 1 },
            },
            upsert: true,
          },
        })),
        { ordered: false }
      );
    }

    // ✅ bulk save Gemini -> WarningWord
    if (geminiToWarn.size) {
      const arr = [...geminiToWarn];
      await Word.bulkWrite(
        arr.map((w) => ({
          updateOne: {
            filter: { value: w },
            update: {
              $set: { kind: "WarningWord", lastSeenAt: now },
              $setOnInsert: { value: w, source: "gemini_policy", synonyms: [], hitCount: 0 },
              $inc: { hitCount: 1 },
            },
            upsert: true,
          },
        })),
        { ordered: false }
      );
    }

    const summary = {
      total: results.length,
      pass: results.filter((x) => x.status === "PASS").length,
      warn: results.filter((x) => x.status === "WARN").length,
      block: results.filter((x) => x.status === "BLOCK").length,
    };
    console.log({
       
        "issue" : results[0].issues
              })

    return NextResponse.json(
      {
        ok: summary.block === 0 && summary.warn === 0,
        step: "REPORT",
        summary,
        canContinue: summary.block === 0 && summary.warn > 0,
        results,    // ✅ tất cả lỗi của tất cả hàng
        rowsReady,  // ✅ PASS + WARN để extension fill/publish
      },
      { headers: cors(req) }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500, headers: cors(req) });
  }
}
