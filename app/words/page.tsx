"use client";
import { useEffect, useState } from "react";

export default function WordsPage() {
  const [allow, setAllow] = useState<string[]>([]);
  const [block, setBlock] = useState<string[]>([]);
  const [newWord, setNewWord] = useState("");
  const [type, setType] = useState<"allow"|"block">("allow");

  async function load() {
    const res = await fetch("/api/words");
    const data = await res.json();
    setAllow(data.allow);
    setBlock(data.block);
  }

  async function addWord() {
    if (!newWord) return;
    await fetch("/api/words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, value: newWord })
    });
    setNewWord("");
    load();
  }

  async function delWord(t: "allow"|"block", value: string) {
    await fetch(`/api/words?type=${t}&value=${encodeURIComponent(value)}`, {
      method: "DELETE"
    });
    load();
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="p-8">
      <h1 className="text-xl font-bold mb-4">Allowed / Blocked Words</h1>
      <div className="flex gap-8">
        <div className="flex-1">
          <h2 className="font-semibold mb-2">✅ Allowed</h2>
          <ul>
            {allow.map(w => (
              <li key={w} className="flex justify-between border-b">
                <span>{w}</span>
                <button onClick={() => delWord("allow", w)}>❌</button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex-1">
          <h2 className="font-semibold mb-2">🚫 Blocked</h2>
          <ul>
            {block.map(w => (
              <li key={w} className="flex justify-between border-b">
                <span>{w}</span>
                <button onClick={() => delWord("block", w)}>❌</button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6">
        <input
          value={newWord}
          onChange={e => setNewWord(e.target.value)}
          placeholder="new word..."
          className="border px-2 py-1 rounded mr-2"
        />
        <select value={type} onChange={e => setType(e.target.value as any)}>
          <option value="allow">Allow</option>
          <option value="block">Block</option>
        </select>
        <button className="ml-2 px-3 py-1 bg-blue-600 text-white rounded" onClick={addWord}>Add</button>
      </div>
    </div>
  );
}
