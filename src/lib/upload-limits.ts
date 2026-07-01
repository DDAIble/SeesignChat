/**
 * Vercel Serverless Functions 공식 한도 — 요청/응답 본문 각 4.5MB.
 * @see https://vercel.com/docs/functions/limitations#request-body-size
 */
export const VERCEL_FUNCTION_BODY_LIMIT_BYTES = Math.floor(4.5 * 1024 * 1024);

/**
 * 원본 파일을 서버에 통째로 보내지 않고 브라우저에서 파싱·청크 전송을 쓰는 기준.
 * Vercel 4.5MB 한도보다 약간 낮게 잡습니다.
 */
export function getClientChunkUploadThresholdBytes(): number {
  return Math.floor(VERCEL_FUNCTION_BODY_LIMIT_BYTES * 0.9);
}

function getPositiveEnvInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 서비스가 허용하는 최대 파일 크기 (UPLOAD_MAX_BYTES).
 * Vercel 한도(4.5MB)가 아닙니다. 더 큰 파일은 브라우저에서 파싱 후 청크로 전송합니다.
 */
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;

const DEFAULT_MAX_QA_INDEX_ROWS = 5000;

export function getUploadMaxFileBytes(): number {
  return getPositiveEnvInt("UPLOAD_MAX_BYTES", DEFAULT_MAX_FILE_BYTES);
}

export function getMaxQaIndexRows(): number {
  return getPositiveEnvInt("RAG_MAX_QA_INDEX_ROWS", DEFAULT_MAX_QA_INDEX_ROWS);
}

/** 업로드 UI·검증용 한도 */
export interface UploadLimits {
  /** 서비스 설정 (UPLOAD_MAX_BYTES) */
  maxFileBytes: number;
  /** Vercel 공식 API 요청 본문 한도 (4.5MB) */
  vercelRequestBodyLimitBytes: number;
}

export function getUploadLimits(): UploadLimits {
  return {
    maxFileBytes: getUploadMaxFileBytes(),
    vercelRequestBodyLimitBytes: VERCEL_FUNCTION_BODY_LIMIT_BYTES,
  };
}
