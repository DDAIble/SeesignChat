import { createGcsStore } from "./gcs-store";
import { createVercelBlobStore } from "./vercel-blob-store";
import { NOOP_BLOB_STORE, type UploadBlobStore } from "./types";

export type { StoredObjectMeta, UploadBlobStore } from "./types";

let cachedStore: UploadBlobStore | null = null;

function resolveProvider(): "gcs" | "vercel-blob" | "none" {
  if (process.env.GCS_UPLOAD_BUCKET) return "gcs";
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) {
    return "vercel-blob";
  }
  return "none";
}

/**
 * 환경변수로 저장소 제공자를 선택합니다.
 * 1) GCS_UPLOAD_BUCKET → Google Cloud Storage (Cloud Run 권장)
 * 2) BLOB_READ_WRITE_TOKEN | BLOB_STORE_ID → Vercel Blob (기존 배포 호환)
 * 3) 없으면 인메모리만 (개발용)
 */
export function getUploadBlobStore(): UploadBlobStore {
  if (cachedStore) return cachedStore;

  const provider = resolveProvider();
  if (provider === "gcs") {
    cachedStore = createGcsStore(process.env.GCS_UPLOAD_BUCKET!);
  } else if (provider === "vercel-blob") {
    cachedStore = createVercelBlobStore();
  } else {
    cachedStore = NOOP_BLOB_STORE;
  }

  return cachedStore;
}

/** 영속 저장소가 구성되어 있는지 */
export function isBlobPersistenceEnabled(): boolean {
  return getUploadBlobStore().enabled;
}
