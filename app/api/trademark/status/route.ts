import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { AllowWord, BlockWord, WarningWord, Word } from "@/models/Words";
import { callTMHunt } from "@/lib/tmhunt";

function norm(value: unknown) {
  return String(value ?? "").toLowerCase().trim();
}

function uniq(values: string[]) {
  return Array.from(new Set(values));
}

function parseGeminiPolicyResponse(text: string) {
  const statusMatch = text.match(/AI_Status:\s*(SAFE|WARNING)/i);
  const reasonMatch = text.match(/Reason:\s*(.+)/i);
  const ai_status = statusMatch?.[1]?.toUpperCase() === "WARNING" ? "WARNING" : "SAFE";
  const ai_reason = reasonMatch?.[1]?.trim() || "";
  return { ai_status, ai_reason };
}

async function geminiPolicyCheck(input: {
  title?: string;
  bullet1?: string;
  bullet2?: string;
  description?: string;
  text?: string;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Server missing GEMINI_API_KEY");

  const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash-preview-09-2025";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `You are a strict Amazon Merch on Demand Policy Enforcement AI.
Your goal is to protect the user's account by detecting ANY potential violation in Brand, Title, Bullets, and Description.

Analyze the input based on these OFFICIAL AMAZON CONTENT POLICIES & BEST PRACTICES:

1. METADATA, QUALITY & PUFFERY (STRICTEST ENFORCEMENT):
   Amazon bans promotional content and subjective descriptions. YOU MUST FLAG:
   - **PUFFERY WORDS (Quảng cáo lố):** "Perfect" (e.g., perfect gift, perfect fit), "Best" (e.g., best mom shirt), "Guaranteed", "Satisfaction", "Must have".
   - **QUALITY CLAIMS (Mô tả chất lượng):** "Premium", "High Quality", "Soft", "Heavyweight", "Durable", "Comfortable", "100% Cotton", "Size", "Fit". (Amazon automatic adds these; users cannot).
   - **FULFILLMENT/PROMO:** "Free Shipping", "Fast Delivery", "Made in USA", "Sale", "Discount", "New", "Limited Time", "Order now".
   - **REDUNDANT WORDS (Trong Title):** "Shirt", "Tee", "T-Shirt", "Hoodie", "Gift" (System adds item names automatically; user shouldn't add them to Title).
   - **KEYWORD STUFFING:** Lists of unrelated keywords (e.g., "birthday christmas halloween thanksgiving").

2. ILLEGAL & INFRINGING (Intellectual Property):
   - Trademarks, Copyrights, Famous Brands (Nike, Disney, Marvel...), Celebrities, Song Lyrics.
   - Protected Events: "Olympic", "Super Bowl", "World Cup".
   - "Parody" that uses protected names or likenesses.

3. OFFENSIVE & CONTROVERSIAL:
   - Hate speech, violence, racism, religious intolerance.
   - Human tragedies, natural disasters, mass shootings.
   - Inflammatory content aiming to attack a group.

4. YOUTH POLICY (Safety Check):
   - Alcohol, Drugs, Tobacco, Sexual content, or Profanity.
   - If found, output WARNING (Risk if applied to Youth sizes).

INSTRUCTIONS:
- **ZERO TOLERANCE** for the word **"PERFECT"**, **"PREMIUM"**, or **"BEST"**. If found -> WARNING.
- If Title contains "Shirt", "Tee", or "Gift" -> WARNING (Redundant Metadata).
- If bullets list material (Cotton/Polyester) -> WARNING (Quality Claim).

RESPONSE FORMAT (Strictly 2 lines):
Line 1: AI_Status: [SAFE or WARNING]
Line 2: Reason: [Explain the specific violation briefly in VIETNAMESE, e.g., "Dùng từ cấm Perfect/Premium", "Nhồi nhét từ khóa", "Vi phạm bản quyền"]

INPUT:
- Title: ${input.title || ""}
- Bullet 1: ${input.bullet1 || ""}
- Bullet 2: ${input.bullet2 || ""}
- Description: ${input.description || ""}
- Text: ${input.text || ""}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
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

  return parseGeminiPolicyResponse(text);
}

export async function POST(req: Request) {
  try {
    const { text, title, bullet1, bullet2, description } = await req.json();
    const combined =
      typeof text === "string" && text.trim().length > 0
        ? text
        : [title, bullet1, bullet2, description].filter(Boolean).join(" ");
    const normalized = combined.toLowerCase();

    await connectMongo();

    const allow = (await AllowWord.find({}).lean()).map((x: any) => norm(x.value));
    const block = (await BlockWord.find({}).lean()).map((x: any) => norm(x.value));
    const warning = (await WarningWord.find({}).lean()).map((x: any) => norm(x.value));
    const allowSet = new Set(allow.filter(Boolean));
    const blockSet = new Set(block.filter(Boolean));
    const warningSet = new Set(warning.filter(Boolean));

    const blockedWords = uniq(block.filter((w) => w && normalized.includes(w) && !allowSet.has(w)));
    const warningWords = uniq(warning.filter((w) => w && normalized.includes(w) && !allowSet.has(w)));

    let tmhuntWords: string[] = [];
    if (normalized.trim().length > 0) {
      const tm = await callTMHunt(normalized);
      const liveMarksRaw: string[] = Array.isArray(tm?.liveMarks)
        ? tm.liveMarks.map((x: any) =>
            typeof x === "string" ? x : x?.[1] ?? x?.wordmark ?? x?.mark ?? ""
          )
        : [];
      const liveMarks = uniq(liveMarksRaw.map(norm).filter(Boolean));
      tmhuntWords = liveMarks.filter((m) => !allowSet.has(m));

      const tmhuntNewWords = tmhuntWords.filter(
        (value) => !blockSet.has(value) && !warningSet.has(value)
      );

      if (tmhuntNewWords.length > 0) {
        await Promise.all(
          tmhuntNewWords.map((value) =>
            Word.updateOne(
              { value },
              {
                $set: {
                  kind: "BlockWord",
                  source: "tmhunt",
                },
                $setOnInsert: { value },
              },
              { upsert: true }
            )
          )
        );
      }
    }

    const allBlocked = uniq([...blockedWords, ...tmhuntWords]);

    let status: "safe" | "warning" | "block" = "safe";
    if (allBlocked.length > 0) {
      status = "block";
    } else if (warningWords.length > 0) {
      status = "warning";
    }

    const { ai_status, ai_reason } = await geminiPolicyCheck({
      text,
      title,
      bullet1,
      bullet2,
      description,
    });

    return NextResponse.json({
      status,
      warningWords,
      blockedWords: allBlocked,
      tmhuntWords,
      ai_status,
      ai_reason,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
