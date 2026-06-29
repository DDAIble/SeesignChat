"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { CitationRowData, CitationSource } from "@/lib/citations";

function CitationTable({ rows }: { rows: CitationRowData[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[36rem] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <th className="whitespace-nowrap px-3 py-2.5 font-semibold text-slate-700">행</th>
            <th className="min-w-[8rem] px-3 py-2.5 font-semibold text-slate-700">제목</th>
            <th className="min-w-[12rem] px-3 py-2.5 font-semibold text-slate-700">본문</th>
            <th className="whitespace-nowrap px-3 py-2.5 font-semibold text-slate-700">날짜</th>
            <th className="min-w-[6rem] px-3 py-2.5 font-semibold text-slate-700">커뮤니티</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row) => (
            <tr key={row.rowIndex} className="align-top hover:bg-slate-50/80">
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{row.rowIndex}</td>
              <td className="px-3 py-2.5 font-medium text-slate-900">{row.title || "-"}</td>
              <td className="max-w-md px-3 py-2.5 text-slate-700">
                <p className="whitespace-pre-wrap">{row.body || "-"}</p>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{row.date || "-"}</td>
              <td className="px-3 py-2.5 text-slate-600">{row.community || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CitationDetailModal({
  source,
  onClose,
}: {
  source: CitationSource;
  onClose: () => void;
}) {
  const rowLabel =
    source.rowEnd > source.rowIndex
      ? `행 ${source.rowIndex}~${source.rowEnd}`
      : `행 ${source.rowIndex}`;
  const tableRows =
    source.rows.length > 0
      ? source.rows.filter((row) => (row.body?.trim() ?? "").length > 0)
      : [
          {
            rowIndex: source.rowIndex,
            title: source.title,
            body: source.body,
            date: "-",
            community: "-",
          },
        ];

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`citation-title-${source.index}`}
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="닫기"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[min(85vh,40rem)] w-full max-w-5xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-emerald-700">근거 원문</p>
            <h3
              id={`citation-title-${source.index}`}
              className="mt-1 text-base font-semibold leading-snug text-slate-900"
            >
              {source.title || "(제목 없음)"}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {source.fileName} · {source.sheetName} · {rowLabel}
              {tableRows.length > 1 ? ` · ${tableRows.length}행` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <CitationTable rows={tableRows} />
        </div>
      </div>
    </div>,
    document.body
  );
}
