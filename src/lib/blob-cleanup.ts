import { getUploadBlobStore } from "./storage";

const BLOB_PREFIX = "excel-data/";
const DEFAULT_TTL_HOURS = 24;

function getTtlHours(): number {
  const parsed = Number(process.env.BLOB_TTL_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_HOURS;
}

export interface BlobCleanupResult {
  enabled: boolean;
  provider: string;
  scanned: number;
  deleted: number;
  ttlHours: number;
}

/**
 * `excel-data/` 접두사 객체 중 업로드 후 TTL(기본 24시간)이 지난 항목을 삭제합니다.
 * 클라이언트 정리(탭 닫기 등)가 실패해 남은 고아 파일을 주기적으로 청소하는 용도입니다.
 * 저장소 제공자(GCS/Vercel Blob)에 관계없이 동일하게 동작합니다.
 */
export async function cleanupExpiredBlobs(): Promise<BlobCleanupResult> {
  const ttlHours = getTtlHours();
  const store = getUploadBlobStore();

  if (!store.enabled) {
    return { enabled: false, provider: store.provider, scanned: 0, deleted: 0, ttlHours };
  }

  const cutoff = Date.now() - ttlHours * 60 * 60 * 1000;
  const objects = await store.list(BLOB_PREFIX);

  let deleted = 0;
  for (const object of objects) {
    if (object.uploadedAt < cutoff) {
      await store.delete(object.key);
      deleted += 1;
    }
  }

  return {
    enabled: true,
    provider: store.provider,
    scanned: objects.length,
    deleted,
    ttlHours,
  };
}
