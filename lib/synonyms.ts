import { callTMHunt } from "@/lib/tmhunt";

// normalize token for comparisons
export function normToken(s: string) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s'-]+/gu, ""); // keep letters/numbers/spaces/'/-
}

export function uniq(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const n = normToken(x);
    if (!n) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * Fetch synonyms from a free endpoint.
 * Datamuse is simplest; replace if you prefer.
 */
export async function fetchSynonymsDatamuse(word: string): Promise<string[]> {
  const q = encodeURIComponent(word);
  const url = `https://api.datamuse.com/words?ml=${q}&max=30`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => [])) as Array<{ word: string }>;
  return (data || []).map((x) => x.word).filter(Boolean);
}

/**
 * Filter synonyms:
 * - remove allowlist (safe stopwords)
 * - remove anything TMHunt says is LIVE (unless it's allowlisted)
 * - remove too-short (1 char) etc.
 */
export async function filterSynonymsByTMHuntAndAllowlist(
  synonyms: string[],
  allowlist: string[]
) {
  const allowSet = new Set(allowlist.map(normToken));
  let candidates = uniq(synonyms)
    .filter((x) => x.length >= 2)
    .filter((x) => !allowSet.has(x));

  if (!candidates.length) return [];

  // Call TMHunt once with combined text (cheaper)
  const tm = await callTMHunt(candidates.join(" "));
  const liveMarks = new Set((tm?.liveMarks || []).map(normToken));

  candidates = candidates.filter((w) => !liveMarks.has(normToken(w)));
  return candidates.slice(0, 20);
}
