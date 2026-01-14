"use client";

import { useEffect, useState } from "react";
import BlockWordCard from "@/components/BlockWordCard";

export default function WordsPage() {
  const [allow, setAllow] = useState<string[]>([]);
  const [block, setBlock] = useState<string[]>([]);
  const [newWord, setNewWord] = useState("");
  const [type, setType] = useState<"allow" | "block">("allow");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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
      setBlock(data.block || []);
    } finally {
      setTimeout(() => setLoading(false), 200);
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
      pop("✅ Added");
    } finally {
      setBusy(false);
    }
  }

  async function delWord(t: "allow" | "block", value: string) {
    setBusy(true);
    try {
      await fetch(`/api/words?type=${t}&value=${encodeURIComponent(value)}`, { method: "DELETE" });
      await load();
      pop("🗑️ Deleted");
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
        <div className="rounded-full h-24 w-24 border-t-4 border-blue-600 border-solid animate-spin"></div>
        <h2 className="mt-5 text-xl font-semibold text-gray-600 animate-pulse">Đang tải dữ liệu...</h2>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-4 py-2 rounded-full shadow-lg text-sm">
          {toast}
        </div>
      )}

      <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="p-7 border-b border-gray-100">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-gray-800">Words Manager</h1>
              <p className="text-gray-500 mt-1">Allowlist / Blocklist + synonyms + clear precheck cache</p>
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

          {/* Add word */}
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
              Add
            </button>
          </div>
        </div>

        {/* Lists */}
        <div className="grid grid-cols-1 md:grid-cols-2">
          {/* Allowed */}
          <div className="p-7 border-b md:border-b-0 md:border-r border-gray-100 bg-emerald-50/30">
            <div className="flex items-center gap-2 mb-5">
              <h2 className="text-xl font-bold text-gray-800">Allowlist</h2>
              <span className="ml-auto bg-emerald-100 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-full">
                {allow.length}
              </span>
            </div>

            <ul className="space-y-2">
              {allow.map((w) => (
                <li
                  key={w}
                  className="group flex items-center justify-between p-3 bg-white border border-emerald-100 rounded-xl shadow-sm hover:shadow-md transition-all"
                >
                  <span className="font-medium text-gray-700">{w}</span>
                  <button
                    onClick={() => delWord("allow", w)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    disabled={busy}
                    title="Delete"
                  >
                    🗑️
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Blocked */}
          <div className="p-7 bg-rose-50/30">
            <div className="flex items-center gap-2 mb-5">
              <h2 className="text-xl font-bold text-gray-800">Blocklist</h2>
              <span className="ml-auto bg-rose-100 text-rose-700 text-xs font-bold px-2.5 py-1 rounded-full">
                {block.length}
              </span>
            </div>

            <div className="space-y-2">
              {block.map((w) => (
                <BlockWordCard
                  key={w}
                  value={w}
                  onDelete={async (val) => delWord("block", val)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
