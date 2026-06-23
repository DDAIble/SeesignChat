"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import {
  resolveDisplayedCitations,
  type CitationRowData,
  type CitationSource,
} from "@/lib/citations";

interface CitationListPanelProps {
  content: string;
  citations?: CitationSource[];
}

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
                <p className="line-clamp-6 whitespace-pre-wrap">{row.body || "-"}</p>
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

function CitationDetailModal({
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
  const tableRows = source.rows.length > 0 ? source.rows : [
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
            <p className="text-xs font-medium text-emerald-700">인용 게시글</p>
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

function previewText(source: CitationSource): string {
  const first = source.rows[0];
  const body = first?.body || source.body;
  if (!body) return "";
  const trimmed = body.replace(/\s+/g, " ").trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}

export default function CitationListPanel({ content, citations }: CitationListPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<CitationSource | null>(null);

  const usedCitations = useMemo(
    () => resolveDisplayedCitations(content, citations),
    [content, citations]
  );

  if (usedCitations.length === 0) return null;

  return (
    <div className="mt-3 border-t border-slate-200/80 pt-3">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1.5 text-left text-xs font-medium text-emerald-700 hover:bg-emerald-50/80"
        aria-expanded={expanded}
      >
        <span>답변에 인용한 게시글 {usedCitations.length}건 보기</span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-emerald-600" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-emerald-600" />
        )}
      </button>

      {expanded && (
        <ul className="mt-2 space-y-1.5">
          {usedCitations.map((source) => {
            const preview = previewText(source);
            const meta = [source.rows[0]?.community, source.rows[0]?.date].filter(Boolean);

            return (
              <li key={source.index}>
                <button
                  type="button"
                  onClick={() => setSelected(source)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-emerald-300 hover:bg-emerald-50/50"
                >
                  <p className="text-sm font-medium text-slate-900 line-clamp-2">
                    {source.title || "(제목 없음)"}
                  </p>
                  {preview && (
                    <p className="mt-1 text-xs text-slate-500 line-clamp-2">{preview}</p>
                  )}
                  <p className="mt-1 text-[11px] text-slate-400">
                    {source.fileName}
                    {meta.length > 0 ? ` · ${meta.join(" · ")}` : ""}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <CitationDetailModal source={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
