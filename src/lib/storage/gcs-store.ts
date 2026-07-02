import { Storage } from "@google-cloud/storage";
import type { StoredObjectMeta, UploadBlobStore } from "./types";

/**
 * Google Cloud Storage 기반 업로드 저장소.
 *
 * Cloud Run에서는 서비스 계정(Workload Identity)으로 자동 인증되므로
 * 별도 키 파일 없이 GCS_UPLOAD_BUCKET만 있으면 동작합니다.
 * 로컬에서는 GOOGLE_APPLICATION_CREDENTIALS(키 파일 경로)로 인증합니다.
 */
export function createGcsStore(bucketName: string): UploadBlobStore {
  const storage = new Storage();
  const bucket = storage.bucket(bucketName);

  return {
    enabled: true,
    provider: "gcs",

    async put(key: string, body: string): Promise<void> {
      await bucket.file(key).save(body, {
        contentType: "application/json",
        resumable: false,
      });
    },

    async head(key: string): Promise<boolean> {
      const [exists] = await bucket.file(key).exists();
      return exists;
    },

    async get(key: string): Promise<string | undefined> {
      try {
        const [contents] = await bucket.file(key).download();
        return contents.toString("utf-8");
      } catch {
        return undefined;
      }
    },

    async delete(key: string): Promise<void> {
      try {
        await bucket.file(key).delete({ ignoreNotFound: true });
      } catch {
        // 이미 없는 파일은 무시
      }
    },

    async list(prefix: string): Promise<StoredObjectMeta[]> {
      const [files] = await bucket.getFiles({ prefix });
      return files.map((file) => {
        const timeCreated = file.metadata.timeCreated;
        const uploadedAt = timeCreated ? new Date(timeCreated).getTime() : Date.now();
        return { key: file.name, uploadedAt };
      });
    },
  };
}
