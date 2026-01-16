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

export async function fetchCsvFromSheet(sheetUrl: string) {
  const csvUrl = buildGoogleSheetCsvUrl(sheetUrl);
  if (!csvUrl) {
    throw new Error("Invalid Google Sheet link");
  }

  const csvRes = await fetch(csvUrl, { method: "GET", cache: "no-store", redirect: "follow" });
  if (!csvRes.ok) {
    throw new Error(`Fetch CSV failed: HTTP ${csvRes.status}`);
  }

  return csvRes.text();
}

export function getRowsFromCsv(csvText: string) {
  return toObjectsFromCsv(csvText);
}
