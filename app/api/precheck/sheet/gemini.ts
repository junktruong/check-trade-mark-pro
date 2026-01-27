export async function geminiPolicyCheck(row: any) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Server missing GEMINI_API_KEY");

  const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash-preview-09-2025";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `You are a strict **Amazon Merch on Demand Compliance Reviewer**.
Review listing text and flag ANY potential violations of the Merch Content Policies.

Content Policies focus areas:
1) Illegal or infringing content (copyright, trademark, likeness, or other IP you don't have rights to).
2) Offensive or controversial content (hate, violence, sexual content, graphic violence, illegal activity, profanity used to attack, inflammatory content, tragedies/disasters).
3) Other not allowed (review solicitation, charity claims, references to product/fulfillment/delivery attributes, misleading/deceptive claims, or content likely to cause poor customer experience).

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
      "type":"IP|ILLEGAL|HATE|VIOLENCE|SEXUAL|PROFANITY|DRUGS|TRAGEDY|MISLEADING|REVIEWS|CHARITY|FULFILLMENT|QUALITY|OTHER",
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

export async function geminiPolicyCheckVi(row: any) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Server missing GEMINI_API_KEY");

  const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash-preview-09-2025";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `Bạn là kiểm duyệt viên nghiêm ngặt cho Amazon Merch on Demand.
Hãy rà soát nội dung listing (Title, Bullets, Description) và đánh dấu BẤT KỲ rủi ro vi phạm nào.

Khu vực cần kiểm tra:
1) Nội dung vi phạm pháp lý hoặc xâm phạm quyền sở hữu trí tuệ (bản quyền, thương hiệu, danh tiếng/nhân vật).
2) Nội dung phản cảm/nhạy cảm (thù ghét, bạo lực, tình dục, ma tuý, thảm kịch, ngôn từ xúc phạm).
3) Nội dung khác không cho phép (kêu gọi review, tuyên bố quyên góp, nói về chất lượng sản phẩm/ship/fulfillment, gây hiểu lầm).

**DỮ LIỆU ĐẦU VÀO:**
-Brand: ${row.brand || ""}
-Title: ${row.title || ""}
-Bullet 1: ${row.bullet1 || ""}
-Bullet 2: ${row.bullet2 || ""}
-Description: ${row.description || ""}

Trả về JSON ONLY:
{
  "policy_ok": true|false,
  "policy_issues": [
    {
      "field":"brand|title|bullet1|bullet2|description",
      "type":"IP|ILLEGAL|HATE|VIOLENCE|SEXUAL|PROFANITY|DRUGS|TRAGEDY|MISLEADING|REVIEWS|CHARITY|FULFILLMENT|QUALITY|OTHER",
      "message":"Giải thích ngắn gọn bằng tiếng Việt.",
      "fix_suggestion":"Gợi ý sửa bằng tiếng Việt.",
      "evidence":["trích đoạn vi phạm (nguyên văn)"],
      "terms":["cụm từ rủi ro (chuẩn hoá)"]
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

export async function geminiYouthImageCheck(imageUrl: string, fitType: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Server missing GEMINI_API_KEY");

  const model = process.env.GEMINI_VISION_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const imgRes = await fetch(imageUrl, { cache: "no-store", redirect: "follow" });
  if (!imgRes.ok) throw new Error(`Fetch image failed: HTTP ${imgRes.status}`);

  const contentType = imgRes.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const base64 = buf.toString("base64");

  const prompt = `You are a strict Amazon Merch on Demand reviewer.
Check if this design is appropriate for minors (${fitType}). If it contains adult, sexual, violent, drug-related, hate, or mature themes, flag it.

Return JSON ONLY:
{
  "youth_ok": true|false,
  "issues": [
    {
      "type":"ADULT|SEXUAL|VIOLENCE|DRUGS|HATE|OTHER",
      "message":"short reason"
    }
  ]
}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: contentType,
              data: base64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          youth_ok: { type: "BOOLEAN" },
          issues: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                type: { type: "STRING" },
                message: { type: "STRING" },
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

export function buildHighlightsByField(issues: any[]) {
  const out: Record<string, string[]> = {};
  for (const it of issues || []) {
    const f = String(it?.field || "").toLowerCase();
    const ev = Array.isArray(it?.evidence) ? it.evidence.map((x: any) => String(x)).filter(Boolean) : [];
    if (!f || !ev.length) continue;
    if (!out[f]) out[f] = [];
    out[f].push(...ev);
  }
  for (const k of Object.keys(out)) out[k] = Array.from(new Set(out[k])).slice(0, 20);
  return out;
}
