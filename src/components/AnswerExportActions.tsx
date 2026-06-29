"use client";

import { useRef, useState, type ReactNode } from "react";
import { Check, Copy, FileDown, Loader2 } from "lucide-react";
import {
  answerToPlainText,
  buildAnswerExportFilename,
  copyAnswerText,
  downloadAnswerPdf,
} from "@/lib/answer-export";

interface AnswerExportActionsProps {
  content: string;
  disabled?: boolean;
  children: ReactNode;
}

export default function AnswerExportActions({
  content,
  disabled = false,
  children,
}: AnswerExportActionsProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const hasContent = answerToPlainText(content).length > 0;
  const showActions = hasContent && !disabled;

  const handleCopy = async () => {
    setActionError(null);
    try {
      await copyAnswerText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Copy failed:", error);
      setActionError("복사에 실패했습니다. 브라우저 권한을 확인해 주세요.");
    }
  };

  const handleDownloadPdf = async () => {
    const element = bodyRef.current;
    if (!element) return;

    setActionError(null);
    setDownloading(true);
    try {
      await downloadAnswerPdf(element, buildAnswerExportFilename("pdf"));
    } catch (error) {
      console.error("PDF export failed:", error);
      setActionError("PDF 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="answer-export">
      <div ref={bodyRef} className="answer-export-body">
        {children}
      </div>

      {showActions && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200/80 pt-3">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                복사됨
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                텍스트 복사
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                PDF 생성 중…
              </>
            ) : (
              <>
                <FileDown className="h-3.5 w-3.5" />
                PDF 다운로드
              </>
            )}
          </button>

          {actionError && (
            <p role="alert" className="text-xs text-red-600">
              {actionError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
