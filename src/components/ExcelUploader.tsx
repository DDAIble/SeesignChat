"use client";

import { useCallback, useState } from "react";
import { Upload, FileSpreadsheet, Loader2, X, Plus } from "lucide-react";
import { enqueueFileIndex } from "@/lib/index-queue";
import { readJsonResponse } from "@/lib/fetch-json";
import type { ExcelData } from "@/lib/types";

const MAX_FILES = 10;
const VALID_EXTENSIONS = [".xlsx", ".xls", ".csv"];

interface ExcelUploaderProps {
  files: ExcelData[];
  onAdd: (data: ExcelData) => void;
  onUpdate: (id: string, patch: Partial<ExcelData>) => void;
  onRemove: (id: string) => void;
  onClearAll?: () => void;
}

function isValidExcelFile(file: File): boolean {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return VALID_EXTENSIONS.includes(ext);
}

function indexFileInBackground(
  data: ExcelData,
  onUpdate: (id: string, patch: Partial<ExcelData>) => void
) {
  enqueueFileIndex(data, onUpdate);
}

export default function ExcelUploader({ files, onAdd, onUpdate, onRemove, onClearAll }: ExcelUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainingSlots = MAX_FILES - files.length;

  const parseUploadedFile = async (file: File): Promise<ExcelData> => {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const json = await readJsonResponse<{ data?: ExcelData; error?: string }>(res);

    if (!res.ok) {
      throw new Error(json.error || "업로드 실패");
    }

    return json.data as ExcelData;
  };

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      setError(null);

      const selected = Array.from(fileList).filter(isValidExcelFile);
      if (selected.length === 0) {
        setError("지원 형식: .xlsx, .xls, .csv");
        return;
      }

      if (remainingSlots <= 0) {
        setError(`최대 ${MAX_FILES}개까지 업로드할 수 있습니다.`);
        return;
      }

      const toUpload = selected.slice(0, remainingSlots);
      if (selected.length > remainingSlots) {
        setError(`최대 ${MAX_FILES}개까지 가능합니다. ${remainingSlots}개만 추가됩니다.`);
      }

      setIsParsing(true);

      try {
        for (const file of toUpload) {
          const data = await parseUploadedFile(file);
          onAdd({ ...data, indexStatus: "indexing", indexProgress: { phase: "chunk", percent: 2 } });
          indexFileInBackground(data, onUpdate);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "업로드 중 오류가 발생했습니다.");
      } finally {
        setIsParsing(false);
      }
    },
    [onAdd, onUpdate, remainingSlots]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
    e.target.value = "";
  };

  function renderIndexStatus(file: ExcelData) {
    if (file.indexStatus === "indexing") {
      return <span className="text-slate-500">학습 대기</span>;
    }
    if (file.indexStatus === "error") {
      return <span className="text-red-600">학습 실패</span>;
    }
    if (file.indexedChunks !== undefined) {
      if (file.indexedChunks === 0) {
        return <span>Q&A·리포트 전용</span>;
      }
      return <span>학습 완료 · {file.indexedChunks.toLocaleString()}청크</span>;
    }
    return null;
  }

  const dropZone = (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      className={`relative rounded-xl border-2 border-dashed p-6 text-center transition-colors cursor-pointer ${
        isDragging
          ? "border-emerald-400 bg-emerald-50"
          : "border-slate-200 bg-slate-50 hover:border-emerald-300 hover:bg-emerald-50/50"
      } ${remainingSlots <= 0 ? "opacity-50 pointer-events-none" : ""}`}
    >
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        multiple
        onChange={onFileChange}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        disabled={isParsing || remainingSlots <= 0}
      />
      {isParsing ? (
        <Loader2 className="mx-auto h-8 w-8 text-emerald-500 animate-spin" />
      ) : files.length > 0 ? (
        <Plus className="mx-auto h-8 w-8 text-slate-400" />
      ) : (
        <Upload className="mx-auto h-8 w-8 text-slate-400" />
      )}
      <p className="mt-2 text-sm font-medium text-slate-700">
        {isParsing
          ? "파일 분석 중..."
          : files.length > 0
            ? "파일 추가 (드래그 또는 클릭)"
            : "엑셀 파일을 드래그하거나 클릭"}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        통계·게시글·후기·Q&A 등 · 최대 {MAX_FILES}개
      </p>
    </div>
  );

  return (
    <div className="space-y-3">
      {files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500">
              업로드된 파일 ({files.length}/{MAX_FILES})
            </p>
            {onClearAll && (
              <button
                onClick={onClearAll}
                className="text-xs text-slate-500 hover:text-red-600 transition-colors"
              >
                전체 삭제
              </button>
            )}
          </div>
          <ul className="space-y-2 max-h-48 overflow-y-auto">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2"
              >
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-emerald-900 truncate">{file.fileName}</p>
                  <p className="text-xs text-emerald-600">
                    {file.sheets.length}시트 · {file.sheets.reduce((s, sh) => s + sh.rowCount, 0)}행
                    {" · "}
                    {renderIndexStatus(file)}
                  </p>
                  {file.indexError && (
                    <p className="mt-0.5 text-xs text-red-600 truncate" title={file.indexError}>
                      {file.indexError}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => onRemove(file.id)}
                  className="shrink-0 rounded p-1 text-emerald-600 hover:bg-emerald-100 transition-colors"
                  title="파일 제거"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {dropZone}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
