import { del, get, head, list, put } from "@vercel/blob";
import type { StoredObjectMeta, UploadBlobStore } from "./types";

/** Vercel Blob 기반 업로드 저장소 (기존 배포 호환용) */
export function createVercelBlobStore(): UploadBlobStore {
  return {
    enabled: true,
    provider: "vercel-blob",

    async put(key: string, body: string): Promise<void> {
      await put(key, body, {
        access: "private" as const,
        addRandomSuffix: false,
        contentType: "application/json",
      });
    },

    async head(key: string): Promise<boolean> {
      try {
        await head(key);
        return true;
      } catch {
        return false;
      }
    },

    async get(key: string): Promise<string | undefined> {
      try {
        const result = await get(key, { access: "private" as const });
        if (!result || result.statusCode !== 200 || !result.stream) {
          return undefined;
        }
        return await new Response(result.stream).text();
      } catch {
        return undefined;
      }
    },

    async delete(key: string): Promise<void> {
      try {
        await del(key);
      } catch {
        // 이미 없는 파일은 무시
      }
    },

    async list(prefix: string): Promise<StoredObjectMeta[]> {
      const results: StoredObjectMeta[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor, limit: 1000 });
        for (const blob of page.blobs) {
          results.push({
            key: blob.pathname,
            uploadedAt: blob.uploadedAt.getTime(),
          });
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return results;
    },
  };
}
