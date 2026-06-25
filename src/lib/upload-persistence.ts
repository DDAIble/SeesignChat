import { del, head, put } from "@vercel/blob";
import type { ExcelData } from "./types";
import { getUploadData, removeUploadData, storeUploadData } from "./upload-data-store";

const BLOB_PREFIX = "excel-data";

function blobPath(fileId: string): string {
  return `${BLOB_PREFIX}/${fileId}.json`;
}

function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function persistToBlob(data: ExcelData): Promise<void> {
  if (!blobEnabled()) return;

  await put(blobPath(data.id), JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

async function loadFromBlob(fileId: string): Promise<ExcelData | undefined> {
  if (!blobEnabled()) return undefined;

  try {
    const meta = await head(blobPath(fileId));
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return undefined;
    return (await res.json()) as ExcelData;
  } catch {
    return undefined;
  }
}

async function deleteFromBlob(fileId: string): Promise<void> {
  if (!blobEnabled()) return;

  try {
    const meta = await head(blobPath(fileId));
    await del(meta.url);
  } catch {
    // missing blob is fine
  }
}

export async function persistUploadData(data: ExcelData): Promise<void> {
  storeUploadData(data);
  await persistToBlob(data);
}

export async function resolveUploadData(fileId: string): Promise<ExcelData | undefined> {
  const cached = getUploadData(fileId);
  if (cached) return cached;

  const fromBlob = await loadFromBlob(fileId);
  if (fromBlob) {
    storeUploadData(fromBlob);
    return fromBlob;
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
