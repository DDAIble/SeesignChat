import type { ExcelData } from "./types";
import { getUploadData, removeUploadData, storeUploadData } from "./upload-data-store";
import { getUploadBlobStore, isBlobPersistenceEnabled } from "./storage";

export { isBlobPersistenceEnabled } from "./storage";

const BLOB_PREFIX = "excel-data";

function blobPath(fileId: string): string {
  return `${BLOB_PREFIX}/${fileId}.json`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function persistToStore(data: ExcelData): Promise<void> {
  const store = getUploadBlobStore();
  await store.put(blobPath(data.id), JSON.stringify(data));

  for (let attempt = 0; attempt < 5; attempt++) {
    if (await store.head(blobPath(data.id))) return;
    if (attempt < 4) await sleep(300 * (attempt + 1));
  }
}

async function loadFromStore(fileId: string): Promise<ExcelData | undefined> {
  const store = getUploadBlobStore();
  if (!store.enabled) return undefined;

  const text = await store.get(blobPath(fileId));
  if (!text) return undefined;
  try {
    return JSON.parse(text) as ExcelData;
  } catch {
    return undefined;
  }
}

async function deleteFromStore(fileId: string): Promise<void> {
  const store = getUploadBlobStore();
  if (!store.enabled) return;
  await store.delete(blobPath(fileId));
}

export async function persistUploadData(data: ExcelData): Promise<void> {
  storeUploadData(data);

  if (!isBlobPersistenceEnabled()) return;

  try {
    await persistToStore(data);
  } catch (error) {
    console.error("Upload persist failed (in-memory upload kept):", error);
  }
}

export async function resolveUploadData(fileId: string): Promise<ExcelData | undefined> {
  const cached = getUploadData(fileId);
  if (cached) return cached;

  for (let attempt = 0; attempt < 5; attempt++) {
    const fromStore = await loadFromStore(fileId);
    if (fromStore) {
      storeUploadData(fromStore);
      return fromStore;
    }
    if (attempt < 4) await sleep(400 * (attempt + 1));
  }

  return undefined;
}

export async function removePersistedUploadData(fileId: string): Promise<void> {
  removeUploadData(fileId);
  await deleteFromStore(fileId);
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
