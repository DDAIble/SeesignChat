import type { ExcelData, IndexPhase } from "@/lib/types";

export function progressFromServerEvent(event: {
  phase: IndexPhase;
  completed: number;
  total: number;
  chunkCount: number;
}): { phase: IndexPhase; percent: number; completed: number; total: number; chunkCount: number } {
  const { phase, completed, total, chunkCount } = event;
  let percent = 0;

  if (phase === "chunk") {
    const ratio = total > 0 ? completed / total : 1;
    percent = Math.round(8 + ratio * 27);
  } else if (phase === "embed") {
    const ratio = total > 0 ? completed / total : 0;
    percent = Math.round(35 + ratio * 58);
  } else {
    percent = 100;
  }

  return { phase, percent, completed, total, chunkCount };
}

export function getLearningStageMessage(percent: number, phase?: IndexPhase): string {
  if (percent < 12) return "SEE:SIGN이 업로드된 파일을 확인하고 있습니다…";
  if (percent < 28) return "엑셀 시트와 게시글·데이터를 읽고 있습니다…";
  if (phase === "chunk" || percent < 42) return "학습에 적합한 단위로 내용을 정리하고 있습니다…";
  if (percent < 68) return "SEE:SIGN이 파일 내용을 학습하고 있습니다…";
  if (percent < 90) return "질문에 바로 답할 수 있도록 검색 인덱스를 만드는 중입니다…";
  return "학습을 마무리하고 있습니다…";
}

export interface AggregateLearningProgress {
  isIndexing: boolean;
  percent: number;
  headline: string;
  detail: string;
}

const UPLOADING_PROGRESS: AggregateLearningProgress = {
  isIndexing: true,
  percent: 4,
  headline: "업로드된 파일을 분석하고 있습니다…",
  detail: "",
};

/** 업로드 파싱·인덱싱 중이면 대화 입력을 막아야 합니다. */
export function isFileProcessing(files: ExcelData[], isUploading: boolean): boolean {
  if (isUploading) return true;
  return files.some((f) => f.indexStatus === "indexing");
}

export function resolveLearningProgressDisplay(
  files: ExcelData[],
  isUploading: boolean
): AggregateLearningProgress {
  const aggregate = computeAggregateLearningProgress(files);
  if (aggregate.isIndexing) return aggregate;
  if (isUploading) return UPLOADING_PROGRESS;
  return aggregate;
}

export function computeAggregateLearningProgress(files: ExcelData[]): AggregateLearningProgress {
  const indexing = files.filter((f) => f.indexStatus === "indexing");
  if (indexing.length === 0) {
    return {
      isIndexing: false,
      percent: 100,
      headline: "",
      detail: "",
    };
  }

  const ready = files.filter((f) => f.indexStatus === "ready");
  const total = indexing.length + ready.length;
  const completedWeight = ready.length * 100;
  const inProgressWeight = indexing.reduce(
    (sum, file) => sum + (file.indexProgress?.percent ?? 4),
    0
  );
  const percent = Math.min(99, Math.round((completedWeight + inProgressWeight) / total));

  const activeFile =
    [...indexing].sort(
      (a, b) => (b.indexProgress?.percent ?? 0) - (a.indexProgress?.percent ?? 0)
    )[0] ?? indexing[0];

  const dominantPhase = activeFile.indexProgress?.phase ?? "chunk";
  const headline = getLearningStageMessage(percent, dominantPhase);
  const fileOrdinal = ready.length + 1;
  const detail =
    total > 1
      ? `${fileOrdinal}/${total}번째 파일 · 「${activeFile.fileName}」`
      : `「${activeFile.fileName}」`;

  return {
    isIndexing: true,
    percent,
    headline,
    detail,
  };
}
