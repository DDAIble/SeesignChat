"use client";

import { useMemo, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Components } from "react-markdown";
import DataChart from "@/components/DataChart";
import MermaidChart from "@/components/MermaidChart";
import CitationDetailModal from "@/components/CitationDetailModal";
import {
  filterBodyContentCitations,
  formatEvidenceLinkLabel,
  formatEvidenceLinkLabelFromRefs,
  parseEvidenceHref,
  preprocessEvidenceLinks,
  resolveEvidenceDisplaySegments,
  stripCitationMarkers,
  type EvidenceDisplaySegment,
  type EvidenceLinkTarget,
  type CitationSource,
} from "@/lib/citations";
import { preprocessAssistantMarkdown } from "@/lib/markdown";
import "katex/dist/katex.min.css";

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "table", "thead", "tbody", "tr", "th", "td", "br"],
  attributes: {
    ...defaultSchema.attributes,
    th: [...(defaultSchema.attributes?.th ?? []), "colSpan", "rowSpan", "align"],
    td: [...(defaultSchema.attributes?.td ?? []), "colSpan", "rowSpan", "align"],
  },
  protocols: {
    ...(defaultSchema.protocols ?? {}),
    href: [...(defaultSchema.protocols?.href ?? []), ""],
  },
};

function getCodeLanguage(className?: string): string | null {
  const match = /language-([\w-]+)/.exec(className ?? "");
  return match?.[1] ?? null;
}

const baseComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-4 mt-6 border-b border-slate-200 pb-2 text-xl font-bold text-slate-900 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-6 text-lg font-bold text-slate-900 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-5 text-base font-semibold text-slate-900 first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-2 mt-5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 first:mt-0">
      {children}
    </h4>
  ),
  p: ({ children }) => <p className="mb-3 last:mb-0 leading-7 text-slate-800">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  em: ({ children }) => <em className="italic text-slate-800">{children}</em>,
  del: ({ children }) => (
    <del className="text-slate-500 line-through decoration-slate-400">{children}</del>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0 marker:text-emerald-600">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1.5 pl-5 last:mb-0 marker:font-medium marker:text-emerald-700">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-7 text-slate-800">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-4 border-emerald-400 bg-emerald-50/50 py-2 pl-4 pr-2 text-slate-700 last:mb-0">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const language = getCodeLanguage(className);
    const code = String(children).replace(/\n$/, "");

    if (language === "chart") {
      return <DataChart specText={code} />;
    }

    if (language === "mermaid") {
      return <MermaidChart code={code} />;
    }

    const isBlock = Boolean(language);
    if (isBlock) {
      return (
        <code className="block overflow-x-auto rounded-lg bg-slate-800 px-4 py-3 font-mono text-[13px] leading-6 text-slate-100">
          {children}
        </code>
      );
    }

    return (
      <code className="rounded-md bg-slate-200/80 px-1.5 py-0.5 font-mono text-[13px] text-slate-800">
        {children}
      </code>
    );
  },
  pre: ({ children }) => {
    return <div className="mb-3 last:mb-0">{children}</div>;
  },
  table: ({ children }) => (
    <div className="mb-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm last:mb-0">
      <table className="w-full min-w-max border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-slate-200 bg-slate-50">{children}</thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-slate-100">{children}</tbody>
  ),
  tr: ({ children }) => <tr className="hover:bg-slate-50/80">{children}</tr>,
  th: ({ children, style }) => (
    <th
      className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
      style={style}
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td className="px-4 py-3 align-top text-slate-800" style={style}>
      {children}
    </td>
  ),
  hr: () => <hr className="my-6 border-slate-200" />,
};

interface MarkdownContentProps {
  content: string;
  citations?: CitationSource[];
}

export default function MarkdownContent({ content, citations = [] }: MarkdownContentProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSegments, setModalSegments] = useState<EvidenceDisplaySegment[]>([]);

  const bodyCitations = useMemo(
    () => filterBodyContentCitations(citations),
    [citations]
  );

  const prepared = useMemo(() => {
    const stripped = stripCitationMarkers(preprocessAssistantMarkdown(content));
    return preprocessEvidenceLinks(stripped, bodyCitations);
  }, [content, bodyCitations]);

  const openEvidenceModal = useCallback(
    (target: EvidenceLinkTarget) => {
      const segments = resolveEvidenceDisplaySegments(target, bodyCitations);
      setModalSegments(segments);
      setModalOpen(true);
    },
    [bodyCitations]
  );

  const components = useMemo((): Components => {
    return {
      ...baseComponents,
      a: ({ href, children }) => {
        const target = href ? parseEvidenceHref(href) : null;
        if (target) {
          const displaySegments = resolveEvidenceDisplaySegments(target, bodyCitations);
          const label =
            displaySegments.length > 0
              ? formatEvidenceLinkLabel(displaySegments)
              : formatEvidenceLinkLabelFromRefs(target.segments);

          return (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openEvidenceModal(target);
              }}
              className="mx-0.5 inline-flex items-center rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 hover:border-emerald-400 hover:bg-emerald-100 cursor-pointer"
              title="클릭하면 참조한 모든 행 본문 보기"
            >
              {label}
            </button>
          );
        }

        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
          >
            {children}
          </a>
        );
      },
    };
  }, [bodyCitations, openEvidenceModal]);

  return (
    <>
      <div className="markdown-content text-[15px] [&_.katex]:text-[1em]">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
          rehypePlugins={[rehypeKatex, rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
          components={components}
        >
          {prepared}
        </ReactMarkdown>
      </div>
      {modalOpen && (
        <CitationDetailModal
          segments={modalSegments}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
