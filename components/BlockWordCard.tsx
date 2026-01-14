"use client";

import { useEffect, useMemo, useState } from "react";

type WordMeta = {
  value: string;
  source?: string;
  synonyms?: string[];
  hitCount?: number;
  lastSeenAt?: string | null;
};

function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export default function BlockWordCard({
  value,
  onDelete,
}: {
  value: string;
  onDelete: (value: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<WordMeta | null>(null);
  const [loading, setLoading] = useState(false);

  const [newSyn, setNewSyn] = useState("");
  const [synBusy, setSynBusy] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);

  const v = useMemo(() => norm(value), [value]);

  async function loadMeta() {
    setLoading(true);
    try {
      const res = await fetch(`/api/words/block?value=${encodeURIComponent(v)}`);
      const data = await res.json();
      if (data?.ok) setMeta(data.word);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && !meta) loadMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function addSynonyms(list: string[]) {
    const add = list.map(norm).filter(Boolean);
    if (!add.length) return;

    setNotice(null);
    setSynBusy(true);
    try {
      const res = await fetch("/api/words/block", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: v, add }),
      });
      const data = await res.json();

      if (!data?.ok) {
        setNotice(data?.error || "Add synonym failed.");
        return;
      }

      if (data?.word) setMeta(data.word);

      const rejected = Array.isArray(data?.rejected) ? data.rejected : [];
      const accepted = Array.isArray(data?.accepted) ? data.accepted : [];

      if (rejected.length) {
        const lines = rejected.map((r: any) => {
          const marks = Array.isArray(r?.liveMarks) && r.liveMarks.length
            ? ` (LIVE: ${r.liveMarks.slice(0, 6).join(", ")}${r.liveMarks.length > 6 ? "…" : ""})`
            : "";
          return `• ${r.value}${marks}`;
        });
        setNotice(
          `Rejected (LIVE trademark):\n${lines.join("\n")}\n\nTip: chọn synonym khác ít rủi ro hơn.`
        );
      } else if (accepted.length) {
        setNotice(`✅ Added: ${accepted.join(", ")}`);
        setTimeout(() => setNotice(null), 1200);
      }
    } finally {
      setSynBusy(false);
    }
  }

  async function removeSynonym(s: string) {
    setNotice(null);
    setSynBusy(true);
    try {
      const res = await fetch("/api/words/block", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: v, remove: [s] }),
      });
      const data = await res.json();
      if (data?.ok) setMeta(data.word);
    } finally {
      setSynBusy(false);
    }
  }

  const synonyms = meta?.synonyms || [];

  return (
    <div className="group rounded-xl border border-rose-100 bg-white shadow-sm hover:shadow-md transition-all">
      <div className="flex items-center justify-between gap-3 p-3">
        <button onClick={() => setOpen((x) => !x)} className="flex-1 text-left" title="Mở rộng">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-800">{value}</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-100">
              BLOCK
            </span>
            {meta?.source ? (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-100">
                {meta.source}
              </span>
            ) : null}
          </div>
          <div className="text-xs text-gray-500 mt-1 flex gap-3 flex-wrap">
            <span>Syn: {synonyms.length}</span>
            <span>Hits: {meta?.hitCount ?? 0}</span>
            <span>Seen: {fmtDate(meta?.lastSeenAt ?? null)}</span>
          </div>
        </button>

        <button
          onClick={() => onDelete(value)}
          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          title="Xoá word"
        >
          🗑️
        </button>
      </div>

      {open && (
        <div className="border-t border-gray-100 px-3 pb-3">
          <div className="pt-3">
            {loading ? (
              <div className="text-sm text-gray-500">Đang tải…</div>
            ) : (
              <>
                {!!notice && (
                  <pre className="mb-3 text-xs bg-gray-900 text-gray-100 p-3 rounded-xl border border-gray-800 whitespace-pre-wrap">
                    {notice}
                  </pre>
                )}

                <div className="flex flex-wrap gap-2">
                  {synonyms.length ? (
                    synonyms.map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border bg-rose-50/40 border-rose-100 text-rose-800"
                      >
                        {s}
                        <button
                          className="ml-1 text-rose-500 hover:text-rose-700"
                          onClick={() => removeSynonym(s)}
                          disabled={synBusy}
                          title="Xoá synonym"
                        >
                          ✕
                        </button>
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-gray-500">Chưa có synonym.</span>
                  )}
                </div>

                <div className="mt-3 flex gap-2">
                  <input
                    value={newSyn}
                    onChange={(e) => setNewSyn(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        addSynonyms([newSyn]);
                        setNewSyn("");
                      }
                    }}
                    placeholder="Thêm synonym (Enter)…"
                    className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-300"
                    disabled={synBusy}
                  />
                  <button
                    onClick={() => {
                      addSynonyms([newSyn]);
                      setNewSyn("");
                    }}
                    disabled={!newSyn.trim() || synBusy}
                    className={`px-4 py-2 rounded-lg font-semibold text-white transition-all ${
                      newSyn.trim() && !synBusy
                        ? "bg-rose-600 hover:bg-rose-700"
                        : "bg-gray-300 cursor-not-allowed"
                    }`}
                  >
                    Add
                  </button>
                </div>

                <div className="text-[12px] text-gray-500 mt-2">
                  Synonym sẽ được check TMHunt trước khi lưu (tránh gợi ý dính LIVE trademark).
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
