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

/** 여러 파일을 순차 업로드할 때의 배치 정보 */
export interface FileUploadActivity {
  active: boolean;
  batchTotal?: number;
  /** 1부터 시작 — 현재 처리 중인 파일 순번 */
  batchIndex?: number;
  activeFileName?: string;
}

const UPLOAD_PARSE_WEIGHT = 8;

function resolveTotalFileSlots(
  files: ExcelData[],
  batchTotal?: number
): number {
  const ready = files.filter((f) => f.indexStatus === "ready").length;
  const indexing = files.filter((f) => f.indexStatus === "indexing").length;
  return Math.max(batchTotal ?? 0, ready + indexing, 1);
}

function buildFileOrdinalDetail(
  fileOrdinal: number,
  totalSlots: number,
  fileName: string
): string {
  if (totalSlots > 1) {
    return `${fileOrdinal}/${totalSlots}번째 파일 · 「${fileName}」`;
  }
  return `「${fileName}」`;
}

function computeUploadingProgress(
  files: ExcelData[],
  activity: FileUploadActivity
): AggregateLearningProgress {
  const readyCount = files.filter((f) => f.indexStatus === "ready").length;
  const sessionTotal = Math.max(
    activity.batchTotal ?? 0,
    readyCount + 1,
    files.length + 1
  );
  const completedBeforeCurrent =
    activity.batchIndex !== undefined
      ? Math.max(0, activity.batchIndex - 1)
      : readyCount;
  const percent = Math.min(
    99,
    Math.round(((completedBeforeCurrent * 100) + UPLOAD_PARSE_WEIGHT) / sessionTotal)
  );
  const fileOrdinal = completedBeforeCurrent + 1;
  const fileName = activity.activeFileName ?? "파일";

  return {
    isIndexing: true,
    percent,
    headline: "업로드된 파일을 분석하고 있습니다…",
    detail: buildFileOrdinalDetail(fileOrdinal, sessionTotal, fileName),
  };
}

/** 업로드 파싱·인덱싱 중이면 대화 입력을 막아야 합니다. */
export function isFileProcessing(
  files: ExcelData[],
  uploadActivity: FileUploadActivity
): boolean {
  if (uploadActivity.active) return true;
  return files.some((f) => f.indexStatus === "indexing");
}

export function resolveLearningProgressDisplay(
  files: ExcelData[],
  uploadActivity: FileUploadActivity
): AggregateLearningProgress {
  const batchTotal = uploadActivity.batchTotal;
  const aggregate = computeAggregateLearningProgress(files, batchTotal);
  if (aggregate.isIndexing) return aggregate;
  if (uploadActivity.active) return computeUploadingProgress(files, uploadActivity);
  return aggregate;
}

export function computeAggregateLearningProgress(
  files: ExcelData[],
  batchTotal?: number
): AggregateLearningProgress {
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
  const totalSlots = resolveTotalFileSlots(files, batchTotal);
  const completedWeight = ready.length * 100;
  const inProgressWeight = indexing.reduce(
    (sum, file) => sum + (file.indexProgress?.percent ?? UPLOAD_PARSE_WEIGHT),
    0
  );
  const percent = Math.min(
    99,
    Math.round((completedWeight + inProgressWeight) / totalSlots)
  );

  const activeFile =
    [...indexing].sort(
      (a, b) => (b.indexProgress?.percent ?? 0) - (a.indexProgress?.percent ?? 0)
    )[0] ?? indexing[0];

  const dominantPhase = activeFile.indexProgress?.phase ?? "chunk";
  const headline = getLearningStageMessage(percent, dominantPhase);
  const fileOrdinal = ready.length + 1;

  return {
    isIndexing: true,
    percent,
    headline,
    detail: buildFileOrdinalDetail(fileOrdinal, totalSlots, activeFile.fileName),
  };
}
