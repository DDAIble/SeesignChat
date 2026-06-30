import { del, list } from "@vercel/blob";
import { isBlobPersistenceEnabled } from "./upload-persistence";

const BLOB_PREFIX = "excel-data/";
const DEFAULT_TTL_HOURS = 24;
const LIST_PAGE_SIZE = 1000;
const DELETE_BATCH_SIZE = 100;

function getTtlHours(): number {
  const parsed = Number(process.env.BLOB_TTL_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_HOURS;
}

export interface BlobCleanupResult {
  enabled: boolean;
  scanned: number;
  deleted: number;
  ttlHours: number;
}

/**
 * `excel-data/` 접두사를 가진 Blob 중 업로드 후 TTL(기본 24시간)이 지난 항목을 삭제합니다.
 * 클라이언트 정리(탭 닫기 등)가 실패해 남은 고아 파일을 주기적으로 청소하는 용도입니다.
 */
export async function cleanupExpiredBlobs(): Promise<BlobCleanupResult> {
  const ttlHours = getTtlHours();

  if (!isBlobPersistenceEnabled()) {
    return { enabled: false, scanned: 0, deleted: 0, ttlHours };
  }

  const cutoff = Date.now() - ttlHours * 60 * 60 * 1000;
  const expiredUrls: string[] = [];
  let scanned = 0;
  let cursor: string | undefined;

  do {
    const result = await list({ prefix: BLOB_PREFIX, cursor, limit: LIST_PAGE_SIZE });
    for (const blob of result.blobs) {
      scanned++;
      if (blob.uploadedAt.getTime() < cutoff) {
        expiredUrls.push(blob.url);
      }
    }
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  let deleted = 0;
  for (let i = 0; i < expiredUrls.length; i += DELETE_BATCH_SIZE) {
    const batch = expiredUrls.slice(i, i + DELETE_BATCH_SIZE);
    await del(batch);
    deleted += batch.length;
  }

  return { enabled: true, scanned, deleted, ttlHours };
}
