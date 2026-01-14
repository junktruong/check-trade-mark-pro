import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { BlockWord } from "@/models/Words";
import { normToken, uniq } from "@/lib/synonyms";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { add = [], remove = [], set = null } = await req.json();

    await connectMongo();
    const doc = await BlockWord.findById(params.id);
    if (!doc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const current = (doc.synonyms || []).map(normToken);

    // set = overwrite
    if (Array.isArray(set)) {
      doc.synonyms = uniq(set.map(normToken));
      await doc.save();
      return NextResponse.json({ ok: true, synonyms: doc.synonyms });
    }

    const addNorm = Array.isArray(add) ? add.map(normToken) : [];
    const removeNorm = new Set(Array.isArray(remove) ? remove.map(normToken) : []);

    const merged = uniq([...current, ...addNorm]).filter((x) => !removeNorm.has(x));
    doc.synonyms = merged;
    await doc.save();

    return NextResponse.json({ ok: true, synonyms: doc.synonyms });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
