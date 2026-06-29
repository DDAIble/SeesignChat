"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  countEvidenceRows,
  type CitationRowData,
  type EvidenceDisplaySegment,
} from "@/lib/citations";

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
  segments,
  onClose,
}: {
  segments: EvidenceDisplaySegment[];
  onClose: () => void;
}) {
  const totalRows = countEvidenceRows(segments);
  const isEmpty = segments.length === 0 || totalRows === 0;

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
      aria-labelledby="evidence-modal-title"
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
            <p className="text-xs font-medium text-emerald-700">출처</p>
            <h3 id="evidence-modal-title" className="mt-1 text-base font-semibold text-slate-900">
              {isEmpty ? "원문을 찾지 못했습니다" : `요약에 참조된 게시글 ${totalRows}건`}
            </h3>
            {!isEmpty && (
              <p className="mt-1 text-xs text-slate-500">
                {segments.length === 1
                  ? `${segments[0].fileName} · ${segments[0].sheetName}`
                  : `${segments.length}개 파일 · ${totalRows}행`}
              </p>
            )}
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
        <div className="space-y-6 overflow-y-auto px-5 py-4">
          {isEmpty ? (
            <p className="text-sm text-slate-600">
              참조 행 데이터를 불러오지 못했습니다. 답변이 완료된 후 다시 시도하거나, 해당 문장의
              출처를 직접 질문해 주세요.
            </p>
          ) : (
            segments.map((segment, index) => (
              <div key={`${segment.fileName}-${segment.sheetName}`}>
                {index > 0 && <hr className="mb-6 border-slate-200" />}
                <div className="mb-3">
                  <p className="text-sm font-semibold text-slate-800">
                    {segment.fileName.replace(/\.(xlsx|xls|csv)$/i, "")}
                  </p>
                  <p className="text-xs text-slate-500">
                    {segment.sheetName} · {segment.rows.map((row) => row.rowIndex).join(", ")}행
                  </p>
                </div>
                <CitationTable rows={segment.rows} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
