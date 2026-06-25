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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function persistToBlob(data: ExcelData): Promise<void> {
  if (!blobEnabled()) return;

  await put(blobPath(data.id), JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });

  // Blob이 다른 인스턴스에서 바로 조회되도록 저장 직후 확인
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

  // 업로드 직후 다른 Vercel 인스턴스에서 Blob 조회가 잠깐 실패할 수 있어 재시도
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
