"use client";

import { useState } from "react";
import Image from "next/image";
import ExcelUploader from "@/components/ExcelUploader";
import DataPreview from "@/components/DataPreview";
import ChatInterface from "@/components/ChatInterface";
import type { ExcelData } from "@/lib/types";

export default function Home() {
  const [excelFiles, setExcelFiles] = useState<ExcelData[]>([]);

  const handleAdd = (data: ExcelData) => {
    setExcelFiles((prev) => [...prev, data]);
  };

  const handleUpdate = (id: string, patch: Partial<ExcelData>) => {
    setExcelFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const handleRemove = async (id: string) => {
    setExcelFiles((prev) => prev.filter((f) => f.id !== id));
    try {
      await fetch(`/api/embed?fileId=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      // UI에서는 이미 제거됨 — 인덱스 정리 실패는 무시
    }
  };

  const handleClearAll = async () => {
    const ids = excelFiles.map((f) => f.id);
    setExcelFiles([]);
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/embed?fileId=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined)
      )
    );
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <Image
            src="/LOGO.svg"
            alt="SEE:SIGN"
            width={154}
            height={38}
            priority
            className="h-9 w-auto"
          />
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">SEE:SIGN CHAT</h1>
            <p className="text-xs text-slate-500">데이터와 대화하세요.</p>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="w-80 shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
              대화할 파일 업로드
            </h2>
            <ExcelUploader
              files={excelFiles}
              onAdd={handleAdd}
              onUpdate={handleUpdate}
              onRemove={handleRemove}
              onClearAll={handleClearAll}
            />
          </div>

          {excelFiles.length > 0 && (
            <div className="flex-1 overflow-y-auto p-4">
              <DataPreview files={excelFiles} />
            </div>
          )}
        </aside>

        <main className="flex flex-1 flex-col min-w-0 bg-white">
          <ChatInterface excelFiles={excelFiles} />
        </main>
      </div>
    </div>
  );
}
