/**
 * 파일당 최대 업로드 크기 기본값.
 * - Vercel: 요청 본문 한도(약 4.5MB) 때문에 UPLOAD_MAX_BYTES=4718592 로 낮춰야 합니다.
 * - Cloud Run: 요청 본문 한도가 넉넉하므로 기본 30MB를 사용합니다.
 */
export const MAX_UPLOAD_FILE_BYTES = 30 * 1024 * 1024;

function getPositiveEnvInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_MAX_QA_INDEX_ROWS = 5000;

export function getUploadMaxFileBytes(): number {
  return getPositiveEnvInt("UPLOAD_MAX_BYTES", MAX_UPLOAD_FILE_BYTES);
}

export function getMaxQaIndexRows(): number {
  return getPositiveEnvInt("RAG_MAX_QA_INDEX_ROWS", DEFAULT_MAX_QA_INDEX_ROWS);
}

/** 업로드 UI·검증용 한도 */
export interface UploadLimits {
  maxFileBytes: number;
}

export function getUploadLimits(): UploadLimits {
  return {
    maxFileBytes: getUploadMaxFileBytes(),
  };
}
