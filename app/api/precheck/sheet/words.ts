import { connectMongo } from "@/lib/mongo";
import { callTMHunt } from "@/lib/tmhunt";
import { AllowWord, WarningWord, BlockWord } from "@/models/Words";
import { norm, uniq } from "./rows";

export function extractLiveTextMarks(tm: any): string[] {
  const src = tm?.liveMarks;
  if (!Array.isArray(src)) return [];

  const out: string[] = [];
  for (const x of src) {
    if (!x) continue;

    if (typeof x === "string") {
      const word = norm(x);
      if (word) out.push(word);
      continue;
    }

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

export async function loadWordData() {
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

  return { allowSet, warn, block, warnMap, blockMap };
}

export async function filterSynonymsByAllowAndTMHunt(syns: string[], allowSet: Set<string>) {
  const candidates = uniq(syns.map(norm).filter(Boolean)).filter((s) => !allowSet.has(s));
  if (!candidates.length) return { safe: [] as string[], live: [] as string[] };

  const tm = await callTMHunt(candidates.join(" "));
  const live = uniq(extractLiveTextMarks(tm));
  const liveSet = new Set(live);

  return { safe: candidates.filter((s) => !liveSet.has(s)), live };
}

export async function buildSuggestionsByWord(
  hits: string[],
  synMap: Map<string, string[]>,
  allowSet: Set<string>
) {
  const suggestionsByWord: Record<string, string[]> = {};
  const allSyns = uniq(hits.flatMap((w) => synMap.get(w) || []).map(norm).filter(Boolean));

  if (!allSyns.length) {
    for (const w of hits) suggestionsByWord[w] = [];
    return suggestionsByWord;
  }

  const { safe } = await filterSynonymsByAllowAndTMHunt(allSyns, allowSet);
  const safeSet = new Set(safe);

  for (const w of hits) {
    const syns = uniq((synMap.get(w) || []).map(norm).filter(Boolean));
    suggestionsByWord[w] = syns.filter((s) => safeSet.has(s)).slice(0, 12);
  }
  return suggestionsByWord;
}
