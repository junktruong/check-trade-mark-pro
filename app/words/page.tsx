"use client";
import { useEffect, useState } from "react";

export default function WordsPage() {
  const [allow, setAllow] = useState<string[]>([]);
  const [block, setBlock] = useState<string[]>([]);
  const [newWord, setNewWord] = useState("");
  const [type, setType] = useState<"allow" | "block">("allow");
  
  // 1. Thêm state loading
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); // Bắt đầu load -> hiện spinner
    try {
      const res = await fetch("/api/words");
      const data = await res.json();
      setAllow(data.allow);
      setBlock(data.block);
    } finally {
      // Dùng finally để đảm bảo dù lỗi hay không thì cũng tắt loading
      // Thêm setTimeout nhỏ (500ms) để hiệu ứng không bị nháy quá nhanh nếu mạng nhanh (tùy chọn)
      setTimeout(() => setLoading(false), 300); 
    }
  }

  async function addWord() {
    if (!newWord) return;
    // Gọi API add
    await fetch("/api/words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, value: newWord }),
    });
    setNewWord("");
    // Gọi lại load để cập nhật danh sách (sẽ kích hoạt lại hiệu ứng loading)
    load();
  }

  async function delWord(t: "allow" | "block", value: string) {
    await fetch(`/api/words?type=${t}&value=${encodeURIComponent(value)}`, {
      method: "DELETE",
    });
    load();
  }

  useEffect(() => {
    load();
  }, []);

  // 2. Giao diện Loading (Hiển thị khi đang loading)
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
        {/* Hiệu ứng Spinner to, đẹp */}
        <div className="relative flex justify-center items-center">
          <div className="absolute animate-spin rounded-full h-32 w-32 border-t-4 border-b-4 border-blue-500"></div>
          <img 
            src="https://www.svgrepo.com/show/509001/avatar-thinking-9.svg" 
            className="rounded-full h-28 w-28 object-cover opacity-50" 
            alt="loading..." // (Optional) Có thể bỏ ảnh nếu chỉ muốn vòng xoay
            style={{display: 'none'}} // Ẩn ảnh demo đi để dùng thuần CSS cho sạch
          /> 
          {/* Vòng tròn loading đơn giản nhưng to */}
          <div className="rounded-full h-24 w-24 border-t-4 border-blue-600 border-solid animate-spin"></div>
        </div>
        <h2 className="mt-5 text-xl font-semibold text-gray-600 animate-pulse">Đang tải dữ liệu...</h2>
      </div>
    );
  }

  // 3. Giao diện chính (Chỉ hiện khi load xong)
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-5xl bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100 animate-fade-in-up">
        
        {/* Header & Input Section */}
        <div className="bg-white border-b border-gray-100 p-8">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-800">Quản lý từ khóa</h1>
            <p className="text-gray-500 mt-1">Thêm hoặc chặn các từ khóa trong hệ thống</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <input
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addWord()}
                placeholder="Nhập từ khóa mới..."
                className="w-full pl-4 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>
            
            <select
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer font-medium text-gray-700"
            >
              <option value="allow">✅ Cho phép</option>
              <option value="block">🚫 Chặn</option>
            </select>

            <button
              onClick={addWord}
              disabled={!newWord}
              className={`px-6 py-3 rounded-lg font-semibold text-white shadow-sm transition-all flex items-center gap-2 justify-center
                ${newWord 
                  ? "bg-blue-600 hover:bg-blue-700 hover:shadow-md cursor-pointer" 
                  : "bg-gray-300 cursor-not-allowed"
                }`}
            >
              Thêm
            </button>
          </div>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2">
          
          {/* Allowed Column */}
          <div className="p-8 border-b md:border-b-0 md:border-r border-gray-100 bg-emerald-50/30">
            <div className="flex items-center gap-2 mb-6">
              <h2 className="text-xl font-bold text-gray-800">Danh sách cho phép</h2>
              <span className="ml-auto bg-emerald-100 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-full">
                {allow.length}
              </span>
            </div>

            <ul className="space-y-2">
              {allow.map((w) => (
                <li key={w} className="group flex items-center justify-between p-3 bg-white border border-emerald-100 rounded-lg shadow-sm hover:shadow-md transition-all">
                  <span className="font-medium text-gray-700">{w}</span>
                  <button
                    onClick={() => delWord("allow", w)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                  >
                    🗑️
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Blocked Column */}
          <div className="p-8 bg-rose-50/30">
            <div className="flex items-center gap-2 mb-6">
              <h2 className="text-xl font-bold text-gray-800">Danh sách chặn</h2>
              <span className="ml-auto bg-rose-100 text-rose-700 text-xs font-bold px-2.5 py-1 rounded-full">
                {block.length}
              </span>
            </div>

            <ul className="space-y-2">
              {block.map((w) => (
                <li key={w} className="group flex items-center justify-between p-3 bg-white border border-rose-100 rounded-lg shadow-sm hover:shadow-md transition-all">
                  <span className="font-medium text-gray-700">{w}</span>
                  <button
                    onClick={() => delWord("block", w)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                  >
                    🗑️
                  </button>
                </li>
              ))}
            </ul>
          </div>

        </div>
      </div>
    </div>
  );
}