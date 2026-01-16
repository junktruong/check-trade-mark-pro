// app/api/precheck/sheet/route.ts
// New endpoint for "server does everything":
// - accepts Google Sheet link
// - server fetches CSV + runs Blocklist/Gemini-policy/TMHunt checks
// - server downloads artwork to compute rankedColors (for color picking)
// - returns prepared rows for the extension

import { NextResponse } from "next/server";
import crypto from "crypto";
import { connectMongo } from "@/lib/mongo";
import { AllowWord, BlockWord } from "@/models/Words";
import { PrecheckCache } from "@/models/PrecheckCache";
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
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

function buildText(r: any) {
  return [r.brand, r.title, r.bullet1, r.bullet2, r.description]
    .filter(Boolean)
    .join(" ");
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

  // Already a CSV export link
  if (/\/export\?/i.test(s) && /format=csv/i.test(s)) return s;

  // Typical: https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0
  const m = s.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return "";

  const id = m[1];
  const gid = parseGidFromUrl(s) || "0";
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${encodeURIComponent(gid)}`;
}

// -------------------- CSV parser (no dependency) --------------------
// Handles: commas, quotes, CRLF/LF, escaped quotes "".
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
    // trim trailing \r
    row = row.map((x) => (x.endsWith("\r") ? x.slice(0, -1) : x));
    // ignore completely empty row
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

  // flush last
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

  // plain URL
  if (/^https?:\/\/\S+$/i.test(s)) return s;

  // <img src="...">
  const m = s.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i);
  if (m && m[1]) return String(m[1]).trim();

  // first URL in the text
  const m2 = s.match(/https?:\/\/[^\s"'<>]+/i);
  return m2 ? m2[0] : "";
}

function pickRowImageUrls(row: any) {
  const fullRaw = row?.image_url ?? row?.image ?? row?.artwork_url ?? row?.artwork ?? "";
  const thumbRaw = row?.thumbnail_url ?? row?.thumb_url ?? row?.image_thumb ?? row?.thumb ?? row?.thumbnail ?? "";
  return {
    fullUrl: extractImgSrc(fullRaw),
    thumbUrl: extractImgSrc(thumbRaw),
  };
}

function cleanRowObject(obj: any) {
  const out: any = {};
  for (const [k, v] of Object.entries(obj || {})) {
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

function isTrulyEmptyRow(obj: any) {
  const vals = Object.values(obj || {});
  return !vals.some((v) => String(v ?? "").trim() !== "");
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

// -------------------- TMHunt parsing (ONLY LIVE + TEXT) --------------------
function extractLiveTextMarks(tm: any): string[] {
  const src = tm?.liveMarks;
  if (!Array.isArray(src)) return [];

  const out: string[] = [];

  for (const x of src) {
    // ✅ STRICT: nếu chỉ là string thì KHÔNG lấy (vì không biết status/type)
    if (typeof x === "string") continue;

    // case: array row
    // Example: ["76491346","LEGEND","LIVE","TEXT", ...]
    if (Array.isArray(x)) {
      const word = norm(x?.[1] ?? "");
      const status = norm(x?.[2] ?? "");
      // một số format có thể lệch index, nên fallback thêm [4]
      const type = norm(x?.[3] ?? x?.[4] ?? "");

      if (!word) continue;
      if (status !== "live") continue;  // ✅ LIVE only
      if (type !== "text") continue;    // ✅ TEXT only

      out.push(word);
      continue;
    }

    // case: object
    if (x && typeof x === "object") {
      const word = norm(
        x?.[1] ??
        x?.wordmark ??
        x?.mark ??
        x?.trademark ??
        x?.text ??
        ""
      );

      const status = norm(
        x?.status ??
        x?.liveStatus ??
        x?.state ??
        x?.[2] ??
        ""
      );

      const type = norm(
        x?.type ??
        x?.markType ??
        x?.kind ??
        x?.[3] ??
        x?.[4] ??
        ""
      );

      if (!word) continue;
      if (status !== "live") continue; // ✅ LIVE only
      if (type !== "text") continue;   // ✅ TEXT only

      out.push(word);
      continue;
    }
  }

  return uniq(out).filter(Boolean);
}

// -------------------- Suggestion filtering: allowlist + TMHunt live-text --------------------
async function filterSynonymsByAllowAndTMHunt(syns: string[], allow: string[]) {
  const allowSet = new Set(allow.map(norm).filter(Boolean));
  const candidates = uniq(syns.map(norm).filter(Boolean)).filter((s) => !allowSet.has(s));

  if (!candidates.length) return { safe: [] as string[], live: [] as string[] };

  const tm = await callTMHunt(candidates.join(" "));
  const live = uniq(extractLiveTextMarks(tm));
  const liveSet = new Set(live);

  const safe = candidates.filter((s) => !liveSet.has(s));
  return { safe, live };
}

// -------------------- Gemini Policy Check (with evidence) --------------------
async function geminiPolicyCheck(row: any) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Server missing GEMINI_API_KEY");

  const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash-preview-09-2025";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `You are a strict **Amazon Merch on Demand Compliance Reviewer**.
Your task is to review the following listing text (Title, Bullets, Description) and flag ANY potential violations of Amazon's Content Policies.

**INPUT DATA:**
-Title: ${row.title || ""}
-Bullet 1: ${row.bullet1 || ""}
-Bullet 2: ${row.bullet2 || ""}
-Description: ${row.description || ""}

**STRICT COMPLIANCE RULES (Based on Amazon Policy):**
1. **ILLEGAL OR INFRINGING (High Risk):**
   - **Trademarks/Copyrights:** Flag any potential use of famous brands (e.g., Disney, Nike), band names, song lyrics, movie quotes, TV shows, video games, or celebrities.
   - **Note:** You are an AI, not a trademark database (USPTO), but you must flag *likely* protected terms.

2. **OFFENSIVE OR CONTROVERSIAL:**
   - **Hate/Violence:** No promotion of hatred, violence, racial/religious intolerance, or human tragedies.
   - **Profanity:** No F-words or attacks on groups.
   - **Drugs:** No promotion of illegal acts or drugs.
   - **Sexual Content:** No pornography or sexually obscene content.
   - **Youth Policy:** If the content is sexual, profane, or promotes violence, it strictly CANNOT be on Youth products (flag this if the text implies it might be sold to kids).

3. **METADATA & CUSTOMER EXPERIENCE (Strictly Enforced):**
   - **Product Quality:** DO NOT describe the shirt itself (e.g., "high quality," "cotton," "soft," "comfortable," "premium fit"). Describe only the *design*.
   - **Shipping/Service:** DO NOT mention "fast shipping," "delivery," "returns," "money back," or "best seller."
   - **Charity/Donations:** DO NOT claim proceeds go to charity.
   - **Keywords:** Avoid keyword stuffing (e.g., "gift for mom dad sister brother...").
   - **Reviews:** DO NOT ask for reviews.

Return JSON ONLY.

IMPORTANT: For each issue, include "evidence": an array of the exact substrings (short snippets) from the field that caused the issue. If unsure, provide your best-guess minimal snippet(s).`;

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

  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("Gemini JSON parse failed: " + String(text).slice(0, 220));
  }

  // normalize evidence arrays
  if (Array.isArray(obj?.policy_issues)) {
    obj.policy_issues = obj.policy_issues.map((it: any) => {
      const evidence = Array.isArray(it?.evidence) ? it.evidence.map((x: any) => String(x)).filter(Boolean).slice(0, 12) : [];
      return {
        field: String(it?.field || ""),
        type: String(it?.type || ""),
        message: String(it?.message || ""),
        fix_suggestion: String(it?.fix_suggestion || ""),
        evidence,
      };
    });
  }

  return obj;
}

function buildHighlightsByField(issues: any[]) {
  const out: Record<string, string[]> = {};
  for (const it of issues || []) {
    const f = String(it?.field || "").toLowerCase();
    if (!f) continue;
    const ev = Array.isArray(it?.evidence) ? it.evidence.map((x: any) => String(x)).filter(Boolean) : [];
    if (!ev.length) continue;
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

function contrastRatio(rgb1: { r: number; g: number; b: number }, rgb2: { r: number; g: number; b: number }) {
  const L1 = relLuminance(rgb1);
  const L2 = relLuminance(rgb2);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

function rankColors(dominantRGB: { r: number; g: number; b: number }) {
  const entries = Object.entries(COLOR_PALETTE).map(([slug, rgb]) => {
    const cr = contrastRatio(dominantRGB, rgb);
    const L = relLuminance(rgb);
    return { slug, cr, L };
  });
  entries.sort((a, b) => b.cr - a.cr);
  return entries.map((e) => ({
    slug: e.slug,
    cr: Number(e.cr.toFixed(4)),
    L: Number(e.L.toFixed(4)),
  }));
}

async function computeRankedColorsFromImageUrl(imageUrl: string) {
  if (!imageUrl) return [];

  // dynamic import to avoid hard crash if sharp isn't installed.
  let sharpMod: any = null;
  try {
    sharpMod = (await import("sharp")).default;
  } catch {
    // If sharp isn't available, just return empty -> extension will skip auto color.
    return [];
  }

  const res = await fetch(imageUrl, {
    cache: "no-store",
    redirect: "follow",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (!res.ok) return [];

  const buf = Buffer.from(await res.arrayBuffer());

  // Downscale to speed.
  const targetW = 64;
  const { data, info } = await sharpMod(buf)
    .ensureAlpha()
    .resize({ width: targetW, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info?.channels || 4;
  let r = 0,
    g = 0,
    b = 0,
    n = 0;

  for (let i = 0; i < data.length; i += channels) {
    const rr = data[i];
    const gg = data[i + 1];
    const bb = data[i + 2];
    const aa = channels >= 4 ? data[i + 3] : 255;

    if (aa < 16) continue;
    r += rr;
    g += gg;
    b += bb;
    n++;
  }

  const dominant = n ? { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) } : { r: 255, g: 255, b: 255 };
  return rankColors(dominant);
}

// -------------------- Main handler --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const sheetUrl = String(body?.sheetUrl || "").trim();
    const options = body?.options || {};
    const enableText = !!options.enableTextCheck;
    const enablePolicy = !!options.enablePolicyCheck;
    const enableTm = !!options.enableTmCheck;

    const ttlDays = Math.max(1, Math.min(365, Number(body?.cacheTtlDays || 7)));
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;

    if (!sheetUrl) {
      return NextResponse.json({ ok: false, error: "sheetUrl is empty" }, { status: 400, headers: cors(req) });
    }

    const csvUrl = buildGoogleSheetCsvUrl(sheetUrl);
    if (!csvUrl) {
      return NextResponse.json({ ok: false, error: "Invalid Google Sheet link (cannot build CSV export URL)" }, { status: 400, headers: cors(req) });
    }

    // fetch CSV
    const csvRes = await fetch(csvUrl, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });

    if (!csvRes.ok) {
      return NextResponse.json({ ok: false, error: `Fetch CSV failed: HTTP ${csvRes.status}` }, { status: 502, headers: cors(req) });
    }

    const csvText = await csvRes.text();

    // parse rows
    const rawRows = toObjectsFromCsv(csvText)
      .map(cleanRowObject)
      .filter((r) => !isTrulyEmptyRow(r))
      .filter((r) => !looksLikeHeaderRow(r))
      .filter((r) => isUsableRow(r));

    if (!rawRows.length) {
      return NextResponse.json({ ok: false, error: "Google Sheet has no usable rows" }, { status: 400, headers: cors(req) });
    }

    // normalize to expected shape
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

    // load allow/block once for whole batch
    const allow = (await AllowWord.find({}).lean()).map((x: any) => norm(x.value)).filter(Boolean);

    const denyDocs = await BlockWord.find({}).lean();
    const deny = denyDocs.map((x: any) => norm(x.value)).filter(Boolean);

    // map value -> synonyms
    const denyMap = new Map<string, string[]>();
    for (const d of denyDocs) {
      const key = norm((d as any)?.value);
      if (!key) continue;
      const syns = Array.isArray((d as any)?.synonyms) ? (d as any).synonyms.map(norm).filter(Boolean) : [];
      denyMap.set(key, syns);
    }

    const flagsKey = `${enableText ? 1 : 0}${enablePolicy ? 1 : 0}${enableTm ? 1 : 0}`;

    const outRows: any[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = r?.name || `Row ${i + 1}`;

      const normalizedText = norm(buildText(r));
      const hash = sha256(flagsKey + "|" + normalizedText);

      // ===== cache hit server-side =====
      const cached = await PrecheckCache.findOne({ hash }).lean();
      if (cached && Date.now() - new Date((cached as any).ts).getTime() <= ttlMs) {
        if (!(cached as any).ok) {
          return NextResponse.json(
            { ok: false, step: (cached as any).step, row: { index: i, name }, details: (cached as any).details, cache: "HIT" },
            { headers: cors(req) }
          );
        }
        // PASS cached -> still need rankedColors for fill; compute fresh (or you can cache separately if you want)
      }

      // ===== Step 1: blocklist =====
      if (enableText) {
        const hits = uniq(deny.filter((w) => w && normalizedText.includes(w)));

        if (hits.length) {
          const now = new Date();

          // optional: track stats for admin
          await BlockWord.updateMany(
            { value: { $in: hits } },
            { $set: { lastSeenAt: now }, $inc: { hitCount: 1 } }
          );

          // build suggestionsByWord from stored synonyms, then filter by allow + TMHunt
          const suggestionsByWord: Record<string, string[]> = {};
          const allSyns = uniq(hits.flatMap((w) => (denyMap.get(w) || []).map(norm)).filter(Boolean));

          if (allSyns.length) {
            const { safe } = await filterSynonymsByAllowAndTMHunt(allSyns, allow);
            const safeSet = new Set(safe);

            for (const w of hits) {
              const syns = uniq((denyMap.get(w) || []).map(norm).filter(Boolean));
              suggestionsByWord[w] = syns.filter((s) => safeSet.has(s)).slice(0, 12);
            }
          } else {
            for (const w of hits) suggestionsByWord[w] = [];
          }

          const fail = {
            ok: false,
            step: "BLOCKLIST",
            row: { index: i, name },
            details: {
              blockedWords: hits,
              suggestionsByWord,
              message: "Replace blocked words using suggested safe alternatives.",
            },
            cache: "MISS",
          };

          await PrecheckCache.updateOne(
            { hash },
            { $set: { ok: false, step: "BLOCKLIST", details: fail.details, ts: now } },
            { upsert: true }
          );

          return NextResponse.json(fail, { headers: cors(req) });
        }
      }

      // ===== Step 2: Gemini policy =====
      if (enablePolicy) {
        const pr = await geminiPolicyCheck(r);
        const ok = !!pr?.policy_ok;

        if (!ok) {
          const issues = Array.isArray(pr?.policy_issues) ? pr.policy_issues : [];
          const fail = {
            ok: false,
            step: "GEMINI_POLICY",
            row: { index: i, name },
            details: { issues, highlightsByField: buildHighlightsByField(issues) },
            cache: "MISS",
          };

          await PrecheckCache.updateOne(
            { hash },
            { $set: { ok: false, step: "GEMINI_POLICY", details: fail.details, ts: new Date() } },
            { upsert: true }
          );

          return NextResponse.json(fail, { headers: cors(req) });
        }
      }

      // ===== Step 3: TMHunt (LIVE + TEXT), allow filter + save blocked =====
      if (enableTm) {
        const tm = await callTMHunt(normalizedText);

        const liveTextMarks = uniq(extractLiveTextMarks(tm));
        const allowSet = new Set(allow);
        const filtered = liveTextMarks.filter((m) => !allowSet.has(m));

        if (filtered.length) {
          // store into DB (source tmhunt)
          const now = new Date();
          await BlockWord.bulkWrite(
            filtered.map((w) => ({
              updateOne: {
                filter: { value: w },
                update: {
                  $setOnInsert: { value: w, source: "tmhunt", createdAt: now, synonyms: [] },
                  $set: { lastSeenAt: now },
                  $inc: { hitCount: 1 },
                },
                upsert: true,
              },
            })),
            { ordered: false }
          );

          const fail = {
            ok: false,
            step: "TMHUNT",
            row: { index: i, name },
            details: {
              liveMarks: filtered,
              message: "These terms appear LIVE (TEXT). Replace/remove, or add to allowlist if intended.",
            },
            cache: "MISS",
          };

          await PrecheckCache.updateOne(
            { hash },
            { $set: { ok: false, step: "TMHUNT", details: fail.details, ts: now } },
            { upsert: true }
          );

          return NextResponse.json(fail, { headers: cors(req) });
        }
      }

      // ===== PASS => cache ok =====
      await PrecheckCache.updateOne(
        { hash },
        { $set: { ok: true, step: "PASS", details: null, ts: new Date() } },
        { upsert: true }
      );

      // ===== server computes rankedColors for extension =====
      let rankedColors: any[] = [];
      try {
        rankedColors = await computeRankedColorsFromImageUrl(String(r.image_url || "").trim());
      } catch {
        rankedColors = [];
      }

      outRows.push({
        ...r,
        rankedColors,
      });
    }

    return NextResponse.json(
      {
        ok: true,
        step: "READY",
        rows: outRows,
        meta: { rows: outRows.length, source: "google_sheet" },
      },
      { headers: cors(req) }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500, headers: cors(req) });
  }
}
