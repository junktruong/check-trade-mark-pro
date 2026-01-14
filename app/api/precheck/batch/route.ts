import { NextResponse } from "next/server";
import crypto from "crypto";
import { connectMongo } from "@/lib/mongo";
import { AllowWord, BlockWord } from "@/models/Words";
import { PrecheckCache } from "@/models/PrecheckCache";
import { callTMHunt } from "@/lib/tmhunt";

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

/** TMHunt parse helper: ONLY LIVE + TEXT */
function extractTmhuntLiveTextMarks(tm: any): string[] {
  const src = tm?.liveMarks;
  if (!Array.isArray(src)) return [];

  const out: string[] = [];

  for (const x of src) {
    let mark = "";
    let status = "";
    let type = "";

    // case 1: string
    if (typeof x === "string") {
      mark = x;
      // assume liveMarks list implies LIVE + TEXT if TMHunt doesn't provide metadata here
      status = "LIVE";
      type = "TEXT";
    }
    // case 2: array row like ["76491346","LEGEND","LIVE","TEXT",...]
    else if (Array.isArray(x)) {
      mark = x?.[1] ?? "";
      const tokens = x
        .filter((v) => typeof v === "string")
        .map((v) => String(v).toUpperCase());

      status =
        tokens.find((t) => t.includes("LIVE")) ||
        tokens.find((t) => t.includes("DEAD")) ||
        tokens.find((t) => t.includes("PENDING")) ||
        "";

      type =
        tokens.find((t) => t === "TEXT" || t.includes("TEXT")) ||
        tokens.find((t) => t === "DESIGN" || t.includes("DESIGN")) ||
        tokens.find((t) => t === "FIGURE" || t.includes("FIGURE")) ||
        "";
    }
    // case 3: object
    else if (typeof x === "object" && x) {
      mark = x?.[1] ?? x?.wordmark ?? x?.mark ?? x?.trademark ?? "";
      status = String(x?.status ?? x?.state ?? x?.lifecycle ?? "").toUpperCase();
      type = String(x?.type ?? x?.markType ?? x?.kind ?? "").toUpperCase();
    }

    const m = norm(mark);
    const s = String(status || "").toUpperCase();
    const t = String(type || "").toUpperCase();

    if (m && s.includes("LIVE") && (t === "TEXT" || t.includes("TEXT"))) {
      out.push(m);
    }
  }

  return uniq(out);
}

/**
 * Filter synonyms:
 * - remove allowlist (safe words)
 * - remove anything TMHunt returns LIVE + TEXT
 */
async function filterSynonymsByAllowAndTMHunt(syns: string[], allow: string[]) {
  const allowSet = new Set(allow.map(norm).filter(Boolean));
  const candidates = uniq(syns.map(norm).filter(Boolean)).filter((s) => !allowSet.has(s));

  if (!candidates.length) return { safe: [] as string[], live: [] as string[] };

  const tm = await callTMHunt(candidates.join(" "));
  const live = uniq(extractTmhuntLiveTextMarks(tm));
  const liveSet = new Set(live);

  const safe = candidates.filter((s) => !liveSet.has(s));
  return { safe, live };
}

async function geminiPolicyCheck(row: any) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Server missing GEMINI_API_KEY");

  const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash-preview-09-2025";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `You are a strict **Amazon Merch on Demand Compliance Reviewer**.
Your task is to review the following listing text (Title, Bullets, Description) and flag ANY potential violations of Amazon's Content Policies.

**INPUT DATA:**
-Brand: ${row.brand || ""}
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

Return JSON:
{
  "policy_ok": true|false,
  "policy_issues": [
    {
      "field":"brand|title|bullet1|bullet2|description",
      "type":"IP|MISLEADING|HATE|ADULT|DRUGS|VIOLENCE|OTHER",
      "message":"...",
      "fix_suggestion":"...",
      "evidence":[
        "EXACT offending substring from that field",
        "another exact substring (optional)"
      ]
    }
  ]
}

Rules for evidence:
- evidence items MUST be exact text copied from the input field (verbatim).
- Keep each evidence short (<= 120 chars) and max 3 per issue.
- If multiple problems exist in one field, include multiple evidence snippets.`;

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
                evidence: {
                  type: "ARRAY",
                  items: { type: "STRING" },
                },
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
  if (!res.ok || data?.error) {
    throw new Error(data?.error?.message || `Gemini HTTP ${res.status}`);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty response");

  return JSON.parse(text);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const options = body?.options || {};
    const enableText = !!options.enableTextCheck;
    const enablePolicy = !!options.enablePolicyCheck;
    const enableTm = !!options.enableTmCheck;

    const ttlDays = Math.max(1, Math.min(365, Number(body?.cacheTtlDays || 7)));
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;

    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "rows is empty" }, { status: 400, headers: cors(req) });
    }

    await connectMongo();

    // load allow/block once for whole batch
    const allow = (await AllowWord.find({}).lean())
      .map((x: any) => norm(x.value))
      .filter(Boolean);

    const denyDocs = await BlockWord.find({}).lean();
    const deny = denyDocs.map((x: any) => norm(x.value)).filter(Boolean);

    // map value -> synonyms
    const denyMap = new Map<string, string[]>();
    for (const d of denyDocs) {
      const key = norm(d?.value);
      if (!key) continue;
      const syns = Array.isArray(d?.synonyms) ? d.synonyms.map(norm).filter(Boolean) : [];
      denyMap.set(key, syns);
    }

    const flagsKey = `${enableText ? 1 : 0}${enablePolicy ? 1 : 0}${enableTm ? 1 : 0}`;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = r?.name || `Row ${i + 1}`;

      const normalizedText = norm(buildText(r));
      const hash = sha256(flagsKey + "|" + normalizedText);

      // ===== cache hit server-side =====
      const cached = await PrecheckCache.findOne({ hash }).lean();
      if (cached && Date.now() - new Date(cached.ts).getTime() <= ttlMs) {
        if (!cached.ok) {
          return NextResponse.json(
            { ok: false, step: cached.step, row: { index: i, name }, details: cached.details, cache: "HIT" },
            { headers: cors(req) }
          );
        }
        continue; // PASS cached
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

          // ✅ build suggestionsByWord from stored synonyms, then filter by allow + TMHunt (LIVE+TEXT)
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
              suggestionsByWord, // ✅ NEW
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

      // ===== Step 2: Gemini policy (with evidence + highlightsByField) =====
      if (enablePolicy) {
        const pr = await geminiPolicyCheck(r);
        const ok = !!pr?.policy_ok;

        if (!ok) {
          const issues = Array.isArray(pr?.policy_issues) ? pr.policy_issues : [];

          // Build highlightsByField for easy UI highlight
          const highlightsByField: Record<string, string[]> = {};
          for (const it of issues) {
            const field = String(it?.field || "other");
            const evs = Array.isArray(it?.evidence) ? it.evidence : [];
            if (!highlightsByField[field]) highlightsByField[field] = [];
            for (const e of evs) if (e) highlightsByField[field].push(String(e));
          }
          for (const k of Object.keys(highlightsByField)) {
            highlightsByField[k] = Array.from(new Set(highlightsByField[k]));
          }

          const fail = {
            ok: false,
            step: "GEMINI_POLICY",
            row: { index: i, name },
            details: { issues, highlightsByField }, // ✅ NEW
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

      // ===== Step 3: TMHunt (ONLY LIVE + TEXT) + allow filter + save blocked =====
      if (enableTm) {
        const tm = await callTMHunt(normalizedText);

        const liveMarks = uniq(extractTmhuntLiveTextMarks(tm)); // ✅ LIVE+TEXT only
        const allowSet = new Set(allow);
        const filtered = liveMarks.filter((m) => !allowSet.has(m));

        if (filtered.length) {
          // ✅ lưu vào DB (source tmhunt)
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

      // PASS => cache ok
      await PrecheckCache.updateOne(
        { hash },
        { $set: { ok: true, step: "PASS", details: null, ts: new Date() } },
        { upsert: true }
      );
    }

    return NextResponse.json({ ok: true, step: "PASS_ALL", cache: "MIX" }, { headers: cors(req) });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message || String(e) },
      { status: 500, headers: cors(req) }
    );
  }
}
