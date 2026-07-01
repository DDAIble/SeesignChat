const DEFAULT_MAX_TOTAL_ROWS = 200_000;
const DEFAULT_MAX_QA_INDEX_ROWS = 5000;

function getPositiveEnvInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** 업로드·분석 가능한 최대 행 수 (UPLOAD_MAX_TOTAL_ROWS) */
export function getUploadMaxTotalRows(): number {
  return getPositiveEnvInt("UPLOAD_MAX_TOTAL_ROWS", DEFAULT_MAX_TOTAL_ROWS);
}

/** Q&A 시트 임베딩(의미검색) 상한 — 초과 시 임베딩 생략 (RAG_MAX_QA_INDEX_ROWS) */
export function getMaxQaIndexRows(): number {
  return getPositiveEnvInt("RAG_MAX_QA_INDEX_ROWS", DEFAULT_MAX_QA_INDEX_ROWS);
}

export interface UploadLimits {
  maxTotalRows: number;
  maxQaIndexRows: number;
}

export function getUploadLimits(): UploadLimits {
  return {
    maxTotalRows: getUploadMaxTotalRows(),
    maxQaIndexRows: getMaxQaIndexRows(),
  };
}
