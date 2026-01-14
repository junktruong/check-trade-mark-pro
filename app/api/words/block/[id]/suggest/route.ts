import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { AllowWord, BlockWord } from "@/models/Words";
import {
  fetchSynonymsDatamuse,
  filterSynonymsByTMHuntAndAllowlist,
  normToken,
  uniq,
} from "@/lib/synonyms";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string } >}
) {
  try {
    const { q } = await req.json(); // optional override term
     const { id } = await params;
    await connectMongo();

    const doc = await BlockWord.findById(id);
    if (!doc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const term = normToken(q || doc.value);
    if (!term) return NextResponse.json({ ok: false, error: "Empty term" }, { status: 400 });

    const allow = (await AllowWord.find({})).map((x: any) => String(x.value || "").toLowerCase());
    const already = new Set((doc.synonyms || []).map((x: string) => normToken(x)));

    const raw = await fetchSynonymsDatamuse(term);
    const filtered = await filterSynonymsByTMHuntAndAllowlist(raw, allow);

    const suggestions = uniq(filtered).filter((x) => !already.has(normToken(x)));

    return NextResponse.json({
      ok: true,
      term,
      suggestions,
      rawCount: raw.length,
      filteredCount: filtered.length,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
