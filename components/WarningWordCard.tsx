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

export default function WarningWordCard({
  value,
  busy,
  onDelete,
  onMove,
}: {
  value: string;
  busy?: boolean;
  onDelete: (value: string) => Promise<void> | void;
  onMove: (value: string, to: "allow" | "warning" | "block") => Promise<void> | void;
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
      const res = await fetch(`/api/words/warning?value=${encodeURIComponent(v)}`);
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
      const res = await fetch("/api/words/warning", {
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
        const lines = rejected.map((r: any) => `• ${r.value}`);
        setNotice(`Rejected (LIVE TEXT trademark):\n${lines.join("\n")}`);
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
      const res = await fetch("/api/words/warning", {
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
    <div className="group rounded-xl border border-amber-100 bg-white shadow-sm hover:shadow-md transition-all">
      <div className="flex items-center justify-between gap-3 p-3">
        <button onClick={() => setOpen((x) => !x)} className="flex-1 text-left" title="Mở rộng">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-800">{value}</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-100">
              WARNING
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

        <div className="flex items-center gap-2">
          <select
            className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-gray-50"
            defaultValue=""
            onChange={(e) => {
              const to = e.target.value as any;
              if (to) onMove(value, to);
              e.currentTarget.value = "";
            }}
            disabled={busy}
            title="Move to"
          >
            <option value="">Move…</option>
            <option value="allow">✅ Allow</option>
            <option value="block">🚫 Block</option>
          </select>

          <button
            onClick={() => onDelete(value)}
            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Xoá word"
            disabled={busy}
          >
            🗑️
          </button>
        </div>
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
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border bg-amber-50/40 border-amber-100 text-amber-900"
                      >
                        {s}
                        <button
                          className="ml-1 text-amber-600 hover:text-amber-800"
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
                    className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
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
                        ? "bg-amber-600 hover:bg-amber-700"
                        : "bg-gray-300 cursor-not-allowed"
                    }`}
                  >
                    Add
                  </button>
                </div>

                <div className="text-[12px] text-gray-500 mt-2">
                  Synonym sẽ được check TMHunt (LIVE+TEXT) trước khi lưu.
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
