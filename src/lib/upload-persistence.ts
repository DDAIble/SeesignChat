import { del, get, head, put } from "@vercel/blob";
import type { ExcelData } from "./types";
import { getUploadData, removeUploadData, storeUploadData } from "./upload-data-store";

const BLOB_PREFIX = "excel-data";
const BLOB_ACCESS = "private" as const;

function blobPath(fileId: string): string {
  return `${BLOB_PREFIX}/${fileId}.json`;
}

/** Vercel Blob 사용 가능 여부 (read-write token 또는 OIDC + store id) */
export function isBlobPersistenceEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function persistToBlob(data: ExcelData): Promise<void> {
  await put(blobPath(data.id), JSON.stringify(data), {
    access: BLOB_ACCESS,
    addRandomSuffix: false,
    contentType: "application/json",
  });

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await head(blobPath(data.id));
      return;
    } catch {
      if (attempt < 4) await sleep(300 * (attempt + 1));
    }
  }
}

async function loadFromBlob(fileId: string): Promise<ExcelData | undefined> {
  if (!isBlobPersistenceEnabled()) return undefined;

  try {
    const result = await get(blobPath(fileId), { access: BLOB_ACCESS });
    if (!result || result.statusCode !== 200 || !result.stream) return undefined;
    const text = await new Response(result.stream).text();
    return JSON.parse(text) as ExcelData;
  } catch {
    return undefined;
  }
}

async function deleteFromBlob(fileId: string): Promise<void> {
  if (!isBlobPersistenceEnabled()) return;

  try {
    await del(blobPath(fileId));
  } catch {
    // missing blob is fine
  }
}

export async function persistUploadData(data: ExcelData): Promise<void> {
  storeUploadData(data);

  if (!isBlobPersistenceEnabled()) return;

  try {
    await persistToBlob(data);
  } catch (error) {
    console.error("Blob persist failed (in-memory upload kept):", error);
  }
}

export async function resolveUploadData(fileId: string): Promise<ExcelData | undefined> {
  const cached = getUploadData(fileId);
  if (cached) return cached;

  for (let attempt = 0; attempt < 5; attempt++) {
    const fromBlob = await loadFromBlob(fileId);
    if (fromBlob) {
      storeUploadData(fromBlob);
      return fromBlob;
    }
    if (attempt < 4) await sleep(400 * (attempt + 1));
  }

  return undefined;
}

export async function removePersistedUploadData(fileId: string): Promise<void> {
  removeUploadData(fileId);
  await deleteFromBlob(fileId);
}

export async function resolveExcelFiles(
  fileIds?: string[],
  fallbackFiles?: ExcelData[]
): Promise<ExcelData[] | undefined> {
  const fallbackById = new Map((fallbackFiles ?? []).map((file) => [file.id, file]));

  if (!fileIds?.length) {
    return fallbackFiles?.length ? fallbackFiles : undefined;
  }

  const resolved: ExcelData[] = [];
  for (const fileId of fileIds) {
    const data = (await resolveUploadData(fileId)) ?? fallbackById.get(fileId);
    if (!data) return undefined;
    resolved.push(data);
  }
  return resolved;
}
