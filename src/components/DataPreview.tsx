"use client";

import { useState } from "react";
import type { ExcelData } from "@/lib/types";

interface DataPreviewProps {
  files: ExcelData[];
}

export default function DataPreview({ files }: DataPreviewProps) {
  const [activeFile, setActiveFile] = useState(0);
  const [activeSheet, setActiveSheet] = useState(0);

  const data = files[activeFile];
  const sheet = data?.sheets[activeSheet];
  const previewRows = sheet?.rows.slice(0, 5) ?? [];

  if (!data) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">데이터 미리보기</h3>
        <span className="text-xs text-slate-500">
          {files.length}개 파일 · 총{" "}
          {files.reduce((sum, f) => sum + f.sheets.reduce((s, sh) => s + sh.rowCount, 0), 0)}행
        </span>
      </div>

      {files.length > 1 && (
        <div className="flex gap-1 flex-wrap">
          {files.map((f, i) => (
            <button
              key={f.id}
              onClick={() => {
                setActiveFile(i);
                setActiveSheet(0);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors truncate max-w-full ${
                activeFile === i
                  ? "bg-slate-800 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
              title={f.fileName}
            >
              {f.fileName}
            </button>
          ))}
        </div>
      )}

      {data.sheets.length > 1 && (
        <div className="flex gap-1 flex-wrap">
          {data.sheets.map((s, i) => (
            <button
              key={s.name}
              onClick={() => setActiveSheet(i)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                activeSheet === i
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {sheet && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {sheet.headers.map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-slate-600 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  {sheet.headers.map((h) => (
                    <td key={h} className="px-3 py-2 text-slate-700 whitespace-nowrap max-w-[150px] truncate">
                      {String(row[h] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {sheet.rowCount > 5 && (
            <p className="px-3 py-2 text-xs text-slate-400 bg-slate-50">
              ... 외 {sheet.rowCount - 5}행
            </p>
          )}
        </div>
      )}
    </div>
  );
}
