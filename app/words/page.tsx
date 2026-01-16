"use client";

import { useEffect, useMemo, useState } from "react";
import BlockWordCard from "@/components/BlockWordCard";
import WarningWordCard from "@/components/WarningWordCard";

export default function WordsPage() {
  const [allow, setAllow] = useState<string[]>([]);
  const [warning, setWarning] = useState<string[]>([]);
  const [block, setBlock] = useState<string[]>([]);

  const [newWord, setNewWord] = useState("");
  const [type, setType] = useState<"allow" | "warning" | "block">("allow");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<"allow" | "warning" | "block", Set<string>>>({
    allow: new Set(),
    warning: new Set(),
    block: new Set(),
  });
  const [visibleCount, setVisibleCount] = useState<Record<"allow" | "warning" | "block", number>>({
    allow: 24,
    warning: 24,
    block: 24,
  });

  const normalizedQuery = query.trim().toLowerCase();

  const filteredAllow = useMemo(() => {
    if (!normalizedQuery) return allow;
    return allow.filter((w) => w.toLowerCase().includes(normalizedQuery));
  }, [allow, normalizedQuery]);

  const filteredWarning = useMemo(() => {
    if (!normalizedQuery) return warning;
    return warning.filter((w) => w.toLowerCase().includes(normalizedQuery));
  }, [warning, normalizedQuery]);

  const filteredBlock = useMemo(() => {
    if (!normalizedQuery) return block;
    return block.filter((w) => w.toLowerCase().includes(normalizedQuery));
  }, [block, normalizedQuery]);

  function pop(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/words");
      const data = await res.json();
      setAllow(data.allow || []);
      setWarning(data.warning || []);
      setBlock(data.block || []);
    } finally {
      setTimeout(() => setLoading(false), 150);
    }
  }

  async function addWord() {
    if (!newWord.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/words", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, value: newWord }),
      });
      setNewWord("");
      await load();
      pop("✅ Added / Moved");
    } finally {
      setBusy(false);
    }
  }

  async function delWord(t: "allow" | "warning" | "block", value: string) {
    setBusy(true);
    try {
      await fetch(`/api/words?type=${t}&value=${encodeURIComponent(value)}`, { method: "DELETE" });
      await load();
      pop("🗑️ Deleted");
    } finally {
      setBusy(false);
    }
  }

  async function moveWord(value: string, to: "allow" | "warning" | "block") {
    setBusy(true);
    try {
      await fetch("/api/words", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: to, value }),
      });
      await load();
      pop(`🔁 Moved → ${to.toUpperCase()}`);
    } finally {
      setBusy(false);
    }
  }

  async function clearPrecheckCache() {
    setBusy(true);
    try {
      const res = await fetch("/api/precheck/cache/clear", { method: "POST" });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Clear failed");
      pop(`🧹 Cleared cache (${data.deleted || 0})`);
    } catch (e: any) {
      pop("❌ " + (e?.message || "Error"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!normalizedQuery) return;
    setVisibleCount({ allow: 24, warning: 24, block: 24 });
  }, [normalizedQuery]);

  function toggleSelect(typeKey: "allow" | "warning" | "block", value: string) {
    setSelected((prev) => {
      const next = { ...prev, [typeKey]: new Set(prev[typeKey]) };
      if (next[typeKey].has(value)) {
        next[typeKey].delete(value);
      } else {
        next[typeKey].add(value);
      }
      return next;
    });
  }

  function setSelectAll(typeKey: "allow" | "warning" | "block", values: string[], checked: boolean) {
    setSelected((prev) => ({
      ...prev,
      [typeKey]: checked ? new Set(values) : new Set(),
    }));
  }

  function clearSelection(typeKey: "allow" | "warning" | "block") {
    setSelected((prev) => ({ ...prev, [typeKey]: new Set() }));
  }

  async function bulkDelete(typeKey: "allow" | "warning" | "block") {
    const items = Array.from(selected[typeKey]);
    if (!items.length) return;
    setBusy(true);
    try {
      await Promise.all(
        items.map((value) =>
          fetch(`/api/words?type=${typeKey}&value=${encodeURIComponent(value)}`, { method: "DELETE" })
        )
      );
      await load();
      clearSelection(typeKey);
      pop(`🗑️ Deleted ${items.length}`);
    } finally {
      setBusy(false);
    }
  }

  async function bulkMove(typeKey: "allow" | "warning" | "block", to: "allow" | "warning" | "block") {
    const items = Array.from(selected[typeKey]);
    if (!items.length) return;
    if (typeKey === to) return;
    setBusy(true);
    try {
      await Promise.all(
        items.map((value) =>
          fetch("/api/words", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: to, value }),
          })
        )
      );
      await load();
      clearSelection(typeKey);
      pop(`🔁 Moved ${items.length} → ${to.toUpperCase()}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-4 py-2 rounded-full shadow-lg text-sm">
          {toast}
        </div>
      )}

      <div className="max-w-7xl mx-auto bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="p-7 border-b border-gray-100">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-gray-800">Words Manager</h1>
              <p className="text-gray-500 mt-1">Allow / Warning / Block + synonyms + clear precheck cache</p>
              {busy && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                  Đang xử lý...
                </div>
              )}
            </div>

            <button
              onClick={clearPrecheckCache}
              disabled={busy}
              className={`px-4 py-2 rounded-lg font-semibold text-white transition-all ${
                !busy ? "bg-slate-800 hover:bg-slate-900" : "bg-gray-300 cursor-not-allowed"
              }`}
              title="Xoá toàn bộ PrecheckCache"
            >
              🧹 Clear precheck cache
            </button>
          </div>

          {/* Add / move word */}
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <input
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addWord()}
              placeholder="Nhập từ khóa mới..."
              className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={busy}
            />

            <select
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer font-medium text-gray-700"
              disabled={busy}
            >
              <option value="allow">✅ Allow</option>
              <option value="warning">⚠️ Warning</option>
              <option value="block">🚫 Block</option>
            </select>

            <button
              onClick={addWord}
              disabled={!newWord.trim() || busy}
              className={`px-6 py-3 rounded-lg font-semibold text-white shadow-sm transition-all ${
                newWord.trim() && !busy
                  ? "bg-blue-600 hover:bg-blue-700 hover:shadow-md"
                  : "bg-gray-300 cursor-not-allowed"
              }`}
            >
              Add / Move
            </button>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm từ khóa..."
              className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={busy}
            />
            <button
              onClick={() => setQuery("")}
              className="px-4 py-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              disabled={!query || busy}
            >
              Clear search
            </button>
          </div>
        </div>

        {/* Lists */}
        <div className="grid grid-cols-1 md:grid-cols-3">
          {/* Allow */}
          <div className="p-7 border-b md:border-b-0 md:border-r border-gray-100 bg-emerald-50/30">
            <div className="flex items-center gap-2 mb-5">
              <h2 className="text-xl font-bold text-gray-800">Allowlist</h2>
              <span className="ml-auto bg-emerald-100 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-full">
                {filteredAllow.length}
              </span>
            </div>

            <div className="flex flex-col gap-2 mb-4">
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={selected.allow.size > 0 && selected.allow.size === filteredAllow.length}
                  onChange={(e) => setSelectAll("allow", filteredAllow, e.target.checked)}
                  disabled={!filteredAllow.length || busy}
                />
                <span>Chọn tất cả ({selected.allow.size})</span>
                <button
                  onClick={() => bulkDelete("allow")}
                  disabled={!selected.allow.size || busy}
                  className="ml-auto px-2 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  Xoá chọn
                </button>
                <select
                  className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-gray-50"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value as any;
                    if (v) bulkMove("allow", v);
                    e.currentTarget.value = "";
                  }}
                  disabled={!selected.allow.size || busy}
                  title="Move selected to"
                >
                  <option value="">Chuyển chọn…</option>
                  <option value="warning">⚠️ Warning</option>
                  <option value="block">🚫 Block</option>
                </select>
              </div>
            </div>

            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div key={idx} className="h-12 rounded-xl bg-white/70 border border-emerald-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                <ul className="space-y-2">
                  {filteredAllow.slice(0, visibleCount.allow).map((w) => (
                    <li
                      key={w}
                      className="group flex items-center justify-between gap-2 p-3 bg-white border border-emerald-100 rounded-xl shadow-sm hover:shadow-md transition-all"
                    >
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selected.allow.has(w)}
                          onChange={() => toggleSelect("allow", w)}
                          disabled={busy}
                        />
                        <span className="font-medium text-gray-700">{w}</span>
                      </label>

                      <div className="flex items-center gap-2">
                        <select
                          className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-gray-50"
                          defaultValue=""
                          onChange={(e) => {
                            const v = e.target.value as any;
                            if (v) moveWord(w, v);
                            e.currentTarget.value = "";
                          }}
                          disabled={busy}
                          title="Move to"
                        >
                          <option value="">Move…</option>
                          <option value="warning">⚠️ Warning</option>
                          <option value="block">🚫 Block</option>
                        </select>

                        <button
                          onClick={() => delWord("allow", w)}
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          disabled={busy}
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {filteredAllow.length > visibleCount.allow && (
                  <button
                    onClick={() =>
                      setVisibleCount((prev) => ({ ...prev, allow: prev.allow + 24 }))
                    }
                    className="mt-4 w-full rounded-lg border border-emerald-200 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
                    disabled={busy}
                  >
                    Xem thêm
                  </button>
                )}
                {!filteredAllow.length && !loading && (
                  <div className="text-sm text-gray-500 mt-3">Không có kết quả.</div>
                )}
              </>
            )}
          </div>

          {/* Warning */}
          <div className="p-7 border-b md:border-b-0 md:border-r border-gray-100 bg-amber-50/30">
            <div className="flex items-center gap-2 mb-5">
              <h2 className="text-xl font-bold text-gray-800">Warninglist</h2>
              <span className="ml-auto bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-1 rounded-full">
                {filteredWarning.length}
              </span>
            </div>

            <div className="flex flex-col gap-2 mb-4">
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={selected.warning.size > 0 && selected.warning.size === filteredWarning.length}
                  onChange={(e) => setSelectAll("warning", filteredWarning, e.target.checked)}
                  disabled={!filteredWarning.length || busy}
                />
                <span>Chọn tất cả ({selected.warning.size})</span>
                <button
                  onClick={() => bulkDelete("warning")}
                  disabled={!selected.warning.size || busy}
                  className="ml-auto px-2 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  Xoá chọn
                </button>
                <select
                  className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-gray-50"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value as any;
                    if (v) bulkMove("warning", v);
                    e.currentTarget.value = "";
                  }}
                  disabled={!selected.warning.size || busy}
                  title="Move selected to"
                >
                  <option value="">Chuyển chọn…</option>
                  <option value="allow">✅ Allow</option>
                  <option value="block">🚫 Block</option>
                </select>
              </div>
            </div>

            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div key={idx} className="h-16 rounded-xl bg-white/70 border border-amber-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {filteredWarning.slice(0, visibleCount.warning).map((w) => (
                    <WarningWordCard
                      key={w}
                      value={w}
                      busy={busy}
                      selected={selected.warning.has(w)}
                      onSelect={() => toggleSelect("warning", w)}
                      onDelete={async (val) => delWord("warning", val)}
                      onMove={async (val, to) => moveWord(val, to)}
                    />
                  ))}
                </div>
                {filteredWarning.length > visibleCount.warning && (
                  <button
                    onClick={() =>
                      setVisibleCount((prev) => ({ ...prev, warning: prev.warning + 24 }))
                    }
                    className="mt-4 w-full rounded-lg border border-amber-200 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50"
                    disabled={busy}
                  >
                    Xem thêm
                  </button>
                )}
                {!filteredWarning.length && !loading && (
                  <div className="text-sm text-gray-500 mt-3">Không có kết quả.</div>
                )}
              </>
            )}
          </div>

          {/* Block */}
          <div className="p-7 bg-rose-50/30">
            <div className="flex items-center gap-2 mb-5">
              <h2 className="text-xl font-bold text-gray-800">Blocklist</h2>
              <span className="ml-auto bg-rose-100 text-rose-700 text-xs font-bold px-2.5 py-1 rounded-full">
                {filteredBlock.length}
              </span>
            </div>

            <div className="flex flex-col gap-2 mb-4">
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={selected.block.size > 0 && selected.block.size === filteredBlock.length}
                  onChange={(e) => setSelectAll("block", filteredBlock, e.target.checked)}
                  disabled={!filteredBlock.length || busy}
                />
                <span>Chọn tất cả ({selected.block.size})</span>
                <button
                  onClick={() => bulkDelete("block")}
                  disabled={!selected.block.size || busy}
                  className="ml-auto px-2 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  Xoá chọn
                </button>
                <select
                  className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-gray-50"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value as any;
                    if (v) bulkMove("block", v);
                    e.currentTarget.value = "";
                  }}
                  disabled={!selected.block.size || busy}
                  title="Move selected to"
                >
                  <option value="">Chuyển chọn…</option>
                  <option value="allow">✅ Allow</option>
                  <option value="warning">⚠️ Warning</option>
                </select>
              </div>
            </div>

            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div key={idx} className="h-16 rounded-xl bg-white/70 border border-rose-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {filteredBlock.slice(0, visibleCount.block).map((w) => (
                    <BlockWordCard
                      key={w}
                      value={w}
                      busy={busy}
                      selected={selected.block.has(w)}
                      onSelect={() => toggleSelect("block", w)}
                      onDelete={async (val) => delWord("block", val)}
                      onMove={async (val, to) => moveWord(val, to)}
                    />
                  ))}
                </div>
                {filteredBlock.length > visibleCount.block && (
                  <button
                    onClick={() =>
                      setVisibleCount((prev) => ({ ...prev, block: prev.block + 24 }))
                    }
                    className="mt-4 w-full rounded-lg border border-rose-200 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                    disabled={busy}
                  >
                    Xem thêm
                  </button>
                )}
                {!filteredBlock.length && !loading && (
                  <div className="text-sm text-gray-500 mt-3">Không có kết quả.</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
