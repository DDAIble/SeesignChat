"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import CitationDetailModal from "@/components/CitationDetailModal";
import {
  filterBodyContentCitations,
  formatEvidenceLinkLabel,
  resolveDisplayedCitations,
  type CitationSource,
} from "@/lib/citations";

interface CitationListPanelProps {
  content: string;
  citations?: CitationSource[];
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

  const bodyCitations = useMemo(
    () => filterBodyContentCitations(citations),
    [citations]
  );

  const usedCitations = useMemo(
    () => resolveDisplayedCitations(content, bodyCitations),
    [content, bodyCitations]
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
                  <p className="text-sm font-medium text-emerald-800">
                    {formatEvidenceLinkLabel(source)}
                  </p>
                  <p className="mt-0.5 text-xs font-medium text-slate-900 line-clamp-2">
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
