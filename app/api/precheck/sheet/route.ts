import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { AllowWord, WarningWord, BlockWord } from "@/models/Words";
import { callTMHunt } from "@/lib/tmhunt";

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

// -------------------- utils --------------------
function norm(s: any) {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}
function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}
function buildText(r: any) {
  return [r.brand, r.title, r.bullet1, r.bullet2, r.description].filter(Boolean).join(" ");
}

// -------------------- Google Sheet -> CSV URL --------------------
function parseGidFromUrl(u: string) {
  try {
    const url = new URL(String(u || "").trim());
    const gidFromQuery = url.searchParams.get("gid");
    if (gidFromQuery) return gidFromQuery;

    const hash = (url.hash || "").replace(/^#/, "");
    const m = hash.match(/(^|&)gid=(\d+)/);
    if (m) return m[2];
  } catch {}
  return "";
}
function buildGoogleSheetCsvUrl(sheetLink: string) {
  const s = String(sheetLink || "").trim();
  if (!s) return "";

  if (/\/export\?/i.test(s) && /format=csv/i.test(s)) return s;

  const m = s.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return "";

  const id = m[1];
  const gid = parseGidFromUrl(s) || "0";
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${encodeURIComponent(gid)}`;
}

// -------------------- CSV parser --------------------
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  const s = String(text ?? "");

  let row: string[] = [];
  let cur = "";
  let i = 0;
  let inQ = false;

  const pushCell = () => {
    row.push(cur);
    cur = "";
  };
  const pushRow = () => {
    row = row.map((x) => (x.endsWith("\r") ? x.slice(0, -1) : x));
    if (row.some((x) => String(x).trim() !== "")) out.push(row);
    row = [];
  };

  while (i < s.length) {
    const ch = s[i];

    if (inQ) {
      if (ch === '"') {
        const next = s[i + 1];
        if (next === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQ = true;
      i++;
      continue;
    }

    if (ch === ",") {
      pushCell();
      i++;
      continue;
    }

    if (ch === "\n") {
      pushCell();
      pushRow();
      i++;
      continue;
    }

    cur += ch;
    i++;
  }

  pushCell();
  pushRow();
  return out;
}

function toObjectsFromCsv(csvText: string): any[] {
  const rows2d = parseCsv(csvText);
  if (!rows2d.length) return [];

  const headers = rows2d[0].map((h) => String(h || "").replace(/^\uFEFF/, "").trim());
  const body = rows2d.slice(1);

  return body.map((r) => {
    const obj: any = {};
    for (let i = 0; i < headers.length; i++) {
      const k = headers[i];
      if (!k) continue;
      obj[k] = (r[i] ?? "").toString();
    }
    return obj;
  });
}

function extractImgSrc(value: any): string {
  const s = String(value || "").trim();
  if (!s) return "";
  if (/^https?:\/\/\S+$/i.test(s)) return s;

  const m = s.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i);
  if (m && m[1]) return String(m[1]).trim();

  const m2 = s.match(/https?:\/\/[^\s"'<>]+/i);
  return m2 ? m2[0] : "";
}

function pickRowImageUrls(row: any) {
  const fullRaw = row?.image_url ?? row?.image ?? row?.artwork_url ?? row?.artwork ?? "";
  const thumbRaw = row?.thumbnail_url ?? row?.thumb_url ?? row?.image_thumb ?? row?.thumb ?? row?.thumbnail ?? "";
  return { fullUrl: extractImgSrc(fullRaw), thumbUrl: extractImgSrc(thumbRaw) };
}

function cleanRowObject(obj: any) {
  const out: any = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = typeof v === "string" ? v.trim() : v;
  return out;
}
function isTrulyEmptyRow(obj: any) {
  return !Object.values(obj || {}).some((v) => String(v ?? "").trim() !== "");
}
function looksLikeHeaderRow(obj: any) {
  const n = String(obj?.name ?? "").trim().toLowerCase();
  const t = String(obj?.title ?? "").trim().toLowerCase();
  const b = String(obj?.brand ?? "").trim().toLowerCase();
  return (n === "name" && t === "title") || (n === "name" && b === "brand");
}
function isUsableRow(obj: any) {
  const name = String(obj?.name ?? "").trim();
  const title = String(obj?.title ?? "").trim();
  const img = extractImgSrc(obj?.image_url ?? obj?.image ?? "");
  return !!(name || title || img);
}

// -------------------- TMHunt parsing (LIVE + TEXT strict) --------------------
function extractLiveTextMarks(tm: any): string[] {
  const src = tm?.liveMarks;
  if (!Array.isArray(src)) return [];

  const out: string[] = [];
  for (const x of src) {
    if (!x) continue;

    // ❌ bỏ string (không có status/type)
    if (typeof x === "string") continue;

    if (Array.isArray(x)) {
      const word = norm(x?.[1] ?? "");
      const status = norm(x?.[2] ?? "");
      const type = norm(x?.[3] ?? x?.[4] ?? "");
      if (word && status === "live" && type === "text") out.push(word);
      continue;
    }

    if (typeof x === "object") {
      const word = norm(x?.[1] ?? x?.wordmark ?? x?.mark ?? x?.trademark ?? x?.text ?? "");
      const status = norm(x?.status ?? x?.liveStatus ?? x?.state ?? x?.[2] ?? "");
      const type = norm(x?.type ?? x?.markType ?? x?.kind ?? x?.[3] ?? x?.[4] ?? "");
      if (word && status === "live" && type === "text") out.push(word);
    }
  }

  return uniq(out).filter(Boolean);
}

// -------------------- Gemini Policy Check (WARNING) --------------------
async function geminiPolicyCheck(row: any) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Server missing GEMINI_API_KEY");

  const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash-preview-09-2025";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `You are a strict **Amazon Merch on Demand Compliance Reviewer**.
Review listing text and flag ANY potential Amazon policy violations.

**INPUT DATA:**
-Brand: ${row.brand || ""}
-Title: ${row.title || ""}
-Bullet 1: ${row.bullet1 || ""}
-Bullet 2: ${row.bullet2 || ""}
-Description: ${row.description || ""}

Return JSON ONLY:
{
  "policy_ok": true|false,
  "policy_issues": [
    {
      "field":"brand|title|bullet1|bullet2|description",
      "type":"IP|MISLEADING|HATE|ADULT|DRUGS|VIOLENCE|OTHER",
      "message":"...",
      "fix_suggestion":"...",
      "evidence":["exact short snippets"],
      "terms":["key risky terms/phrases (normalized)"]
    }
  ]
}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          policy_ok: { type: "BOOLEAN" },
          policy_issues: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                field: { type: "STRING" },
                type: { type: "STRING" },
                message: { type: "STRING" },
                fix_suggestion: { type: "STRING" },
                evidence: { type: "ARRAY", items: { type: "STRING" } },
                terms: { type: "ARRAY", items: { type: "STRING" } },
              },
            },
          },
        },
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error?.message || `Gemini HTTP ${res.status}`);

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty response");

  return JSON.parse(text);
}

function buildHighlightsByField(issues: any[]) {
  const out: Record<string, string[]> = {};
  for (const it of issues || []) {
    const f = String(it?.field || "").toLowerCase();
    const ev = Array.isArray(it?.evidence) ? it.evidence.map((x: any) => String(x)).filter(Boolean) : [];
    if (!f || !ev.length) continue;
    if (!out[f]) out[f] = [];
    out[f].push(...ev);
  }
  for (const k of Object.keys(out)) out[k] = uniq(out[k]).slice(0, 20);
  return out;
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
    const body = await req.json().catch(() => ({}));
    const sheetUrl = String(body?.sheetUrl || "").trim();
    const options = body?.options || {};
    const enableText = !!options.enableTextCheck;
    const enablePolicy = !!options.enablePolicyCheck;
    const enableTm = !!options.enableTmCheck;

    if (!sheetUrl) {
      return NextResponse.json({ ok: false, error: "sheetUrl is empty" }, { status: 400, headers: cors(req) });
    }

    const csvUrl = buildGoogleSheetCsvUrl(sheetUrl);
    if (!csvUrl) {
      return NextResponse.json({ ok: false, error: "Invalid Google Sheet link" }, { status: 400, headers: cors(req) });
    }

    const csvRes = await fetch(csvUrl, { method: "GET", cache: "no-store", redirect: "follow" });
    if (!csvRes.ok) {
      return NextResponse.json({ ok: false, error: `Fetch CSV failed: HTTP ${csvRes.status}` }, { status: 502, headers: cors(req) });
    }

    const csvText = await csvRes.text();

    const rawRows = toObjectsFromCsv(csvText)
      .map(cleanRowObject)
      .filter((r) => !isTrulyEmptyRow(r))
      .filter((r) => !looksLikeHeaderRow(r))
      .filter((r) => isUsableRow(r));

    if (!rawRows.length) {
      return NextResponse.json({ ok: false, error: "Google Sheet has no usable rows" }, { status: 400, headers: cors(req) });
    }

    // normalize
    const rows = rawRows.map((r, i) => {
      const name = String(r?.name || `Row ${i + 1}`);
      const { fullUrl, thumbUrl } = pickRowImageUrls(r);
      return {
        name,
        brand: String(r?.brand || ""),
        title: String(r?.title || ""),
        bullet1: String(r?.bullet1 || r?.bullet_1 || ""),
        bullet2: String(r?.bullet2 || r?.bullet_2 || ""),
        description: String(r?.description || ""),
        price: String(r?.price || ""),
        image_url: String(fullUrl || ""),
        thumbnail_url: String(thumbUrl || ""),
      };
    });

    await connectMongo();

    const allowDocs = await AllowWord.find({}).lean();
    const warnDocs = await WarningWord.find({}).lean();
    const blockDocs = await BlockWord.find({}).lean();

    const allow = allowDocs.map((x: any) => norm(x.value)).filter(Boolean);
    const allowSet = new Set(allow);

    const warn = warnDocs.map((x: any) => norm(x.value)).filter(Boolean);
    const block = blockDocs.map((x: any) => norm(x.value)).filter(Boolean);

    const warnMap = new Map<string, string[]>();
    for (const d of warnDocs as any[]) warnMap.set(norm(d.value), (d.synonyms || []).map(norm).filter(Boolean));

    const blockMap = new Map<string, string[]>();
    for (const d of blockDocs as any[]) blockMap.set(norm(d.value), (d.synonyms || []).map(norm).filter(Boolean));

    async function filterSynonymsByAllowAndTMHunt(syns: string[]) {
      const candidates = uniq(syns.map(norm).filter(Boolean)).filter((s) => !allowSet.has(s));
      if (!candidates.length) return { safe: [] as string[], live: [] as string[] };

      const tm = await callTMHunt(candidates.join(" "));
      const live = uniq(extractLiveTextMarks(tm));
      const liveSet = new Set(live);

      return { safe: candidates.filter((s) => !liveSet.has(s)), live };
    }

    async function buildSuggestionsByWord(hits: string[], synMap: Map<string, string[]>) {
      const suggestionsByWord: Record<string, string[]> = {};
      const allSyns = uniq(hits.flatMap((w) => synMap.get(w) || []).map(norm).filter(Boolean));

      if (!allSyns.length) {
        for (const w of hits) suggestionsByWord[w] = [];
        return suggestionsByWord;
      }

      const { safe } = await filterSynonymsByAllowAndTMHunt(allSyns);
      const safeSet = new Set(safe);

      for (const w of hits) {
        const syns = uniq((synMap.get(w) || []).map(norm).filter(Boolean));
        suggestionsByWord[w] = syns.filter((s) => safeSet.has(s)).slice(0, 12);
      }
      return suggestionsByWord;
    }

    const now = new Date();

    const results: any[] = [];
    const rowsReady: any[] = [];

    const tmhuntToBlock = new Set<string>();
    const geminiToWarn = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = r?.name || `Row ${i + 1}`;
      const normalizedText = norm(buildText(r));

      let status: "PASS" | "WARN" | "BLOCK" = "PASS";
      const issues: any = {};

      // 1) Block words (hard stop)
      if (enableText) {
        const blockHits = uniq(block.filter((w) => w && normalizedText.includes(w) && !allowSet.has(w)));
        if (blockHits.length) {
          status = "BLOCK";
          issues.block = {
            words: blockHits,
            suggestionsByWord: await buildSuggestionsByWord(blockHits, blockMap),
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
            suggestionsByWord: await buildSuggestionsByWord(warnHits, warnMap),
            message: "Warning words found. Review and Continue if acceptable.",
          };

          await WarningWord.updateMany(
            { value: { $in: warnHits } },
            { $set: { lastSeenAt: now }, $inc: { hitCount: 1 } }
          );
        }
      }

      // 3) Gemini policy => ALWAYS WARNING
      if (enablePolicy) {
        try {
          const pr = await geminiPolicyCheck(r);
          const policyOk = !!pr?.policy_ok;
          if (!policyOk) {
            if (status !== "BLOCK") status = "WARN";

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
          if (status !== "BLOCK") status = "WARN";
          issues.geminiPolicy = {
            issues: [],
            message: "Gemini policy check failed (treated as WARNING): " + (e?.message || String(e)),
          };
        }
      }

      // 4) TMHunt => BLOCK + auto-save BlockWord
      if (enableTm) {
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

      results.push({ index: i, name, status, issues });

      // only prepare rowsReady if NOT BLOCK
      if (status !== "BLOCK") {
        let rankedColors: any[] = [];
        try {
          rankedColors = await computeRankedColorsFromImageUrl(String(r.image_url || "").trim());
        } catch {
          rankedColors = [];
        }
        rowsReady.push({ ...r, rankedColors });
      }
    }

    // ✅ bulk save TMHunt -> BlockWord
    if (tmhuntToBlock.size) {
      const arr = [...tmhuntToBlock];
      await BlockWord.bulkWrite(
        arr.map((w) => ({
          updateOne: {
            filter: { value: w },
            update: {
              $setOnInsert: { value: w, source: "tmhunt", synonyms: [] },
              $set: { lastSeenAt: now },
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
      await WarningWord.bulkWrite(
        arr.map((w) => ({
          updateOne: {
            filter: { value: w },
            update: {
              $setOnInsert: { value: w, source: "gemini_policy", synonyms: [] },
              $set: { lastSeenAt: now },
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
