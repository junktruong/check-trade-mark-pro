import crypto from "crypto";

export function norm(s: any) {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

export function buildText(r: any) {
  return [r.brand, r.title, r.bullet1, r.bullet2, r.description].filter(Boolean).join(" ");
}

export function buildRowHash(params: {
  row: any;
  fitType: string;
  enableText: boolean;
  enablePolicy: boolean;
  enableTm: boolean;
}) {
  const payload = {
    name: String(params.row?.name || ""),
    brand: String(params.row?.brand || ""),
    title: String(params.row?.title || ""),
    bullet1: String(params.row?.bullet1 || ""),
    bullet2: String(params.row?.bullet2 || ""),
    description: String(params.row?.description || ""),
    price: String(params.row?.price || ""),
    image_url: String(params.row?.image_url || ""),
    thumbnail_url: String(params.row?.thumbnail_url || ""),
    fitType: String(params.fitType || "none"),
    flags: {
      enableText: !!params.enableText,
      enablePolicy: !!params.enablePolicy,
      enableTm: !!params.enableTm,
    },
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function extractImgSrc(value: any): string {
  const s = String(value || "").trim();
  if (!s) return "";
  if (/^https?:\/\/\S+$/i.test(s)) return s;

  const m = s.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i);
  if (m && m[1]) return String(m[1]).trim();

  const m2 = s.match(/https?:\/\/[^\s"'<>]+/i);
  return m2 ? m2[0] : "";
}

export function pickRowImageUrls(row: any) {
  const fullRaw = row?.image_url ?? row?.image ?? row?.artwork_url ?? row?.artwork ?? "";
  const thumbRaw = row?.thumbnail_url ?? row?.thumb_url ?? row?.image_thumb ?? row?.thumb ?? row?.thumbnail ?? "";
  return { fullUrl: extractImgSrc(fullRaw), thumbUrl: extractImgSrc(thumbRaw) };
}

export function cleanRowObject(obj: any) {
  const out: any = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = typeof v === "string" ? v.trim() : v;
  return out;
}

export function isTrulyEmptyRow(obj: any) {
  return !Object.values(obj || {}).some((v) => String(v ?? "").trim() !== "");
}

export function looksLikeHeaderRow(obj: any) {
  const n = String(obj?.name ?? "").trim().toLowerCase();
  const t = String(obj?.title ?? "").trim().toLowerCase();
  const b = String(obj?.brand ?? "").trim().toLowerCase();
  return (n === "name" && t === "title") || (n === "name" && b === "brand");
}

export function isUsableRow(obj: any) {
  const name = String(obj?.name ?? "").trim();
  const title = String(obj?.title ?? "").trim();
  const img = extractImgSrc(obj?.image_url ?? obj?.image ?? "");
  return !!(name || title || img);
}

export function normalizeRows(rawRows: any[]) {
  return rawRows.map((r, i) => {
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
}

export function buildRowsByName(rows: any[]) {
  const rowsByName = new Map<string, any>();
  for (const r of rows) {
    const n = String(r?.name || "").trim();
    if (n) rowsByName.set(n, r);
  }
  return rowsByName;
}
