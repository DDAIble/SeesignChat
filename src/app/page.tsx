"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight, CircleHelp, Database } from "lucide-react";
import ExcelUploader from "@/components/ExcelUploader";
import DataPreview from "@/components/DataPreview";
import ChatInterface from "@/components/ChatInterface";
import { withBasePath } from "@/lib/base-path";
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
      await fetch(withBasePath(`/api/embed?fileId=${encodeURIComponent(id)}`), {
        method: "DELETE",
      });
    } catch {
      // UI에서는 이미 제거됨 — 인덱스 정리 실패는 무시
    }
  };

  const handleClearAll = async () => {
    const ids = excelFiles.map((f) => f.id);
    setExcelFiles([]);
    await Promise.all(
      ids.map((id) =>
        fetch(withBasePath(`/api/embed?fileId=${encodeURIComponent(id)}`), {
          method: "DELETE",
        }).catch(() => undefined)
      )
    );
  };

  // basePath 밖 플랫폼 루트 — Next.js Link가 /chat을 붙이므로 <a> 사용
  const aibleBoxUrl = process.env.NEXT_PUBLIC_AIBLE_BOX_URL ?? "/";
  const seesignAdminUrl =
    process.env.NEXT_PUBLIC_SEESIGN_ADMIN_URL ?? "https://seesign-admin.digitalds.store/main";
  const chatGuideUrl =
    process.env.NEXT_PUBLIC_CHAT_GUIDE_URL ?? "https://seesign.mintlify.app/guide/chat/ready";

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Image
              src="/aible_logo.svg"
              alt="SEE:SIGN"
              width={154}
              height={38}
              priority
              className="h-9 w-auto"
            />
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-slate-900 leading-tight">AiBLE CHAT</h1>
              <p className="text-xs text-slate-500">데이터와 대화하세요.</p>
            </div>
          </div>

          <a
            href={chatGuideUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-100"
          >
            <CircleHelp className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="whitespace-nowrap">AiBLE CHAT, 넌 뭘 할 수 있니?</span>
          </a>

          <div className="flex justify-end">
            <a
              href={aibleBoxUrl}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              AiBle BOX
            </a>
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

            <a
              href={seesignAdminUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-violet-700 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-violet-500/30 transition-all hover:from-violet-500 hover:via-fuchsia-500 hover:to-violet-600 hover:shadow-violet-500/45 active:scale-[0.98]"
            >
              <Database className="h-4 w-4 shrink-0" />
              <span>SEE:SIGN으로 데이터 수집하러 가기</span>
              <ArrowRight className="h-4 w-4 shrink-0" />
            </a>
            <p className="mt-1.5 text-center text-[11px] text-slate-400">
              매출·커뮤니티·Q&A 등 분석할 데이터를 먼저 모아보세요
            </p>
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
