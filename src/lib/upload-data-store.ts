import type { ExcelData } from "./types";

const globalForUploadStore = globalThis as unknown as {
  __excelAiUploadStore?: Map<string, ExcelData>;
};

function getStore(): Map<string, ExcelData> {
  if (!globalForUploadStore.__excelAiUploadStore) {
    globalForUploadStore.__excelAiUploadStore = new Map();
  }
  return globalForUploadStore.__excelAiUploadStore;
}

export function storeUploadData(data: ExcelData): void {
  getStore().set(data.id, data);
}

export function getUploadData(fileId: string): ExcelData | undefined {
  return getStore().get(fileId);
}

export function removeUploadData(fileId: string): boolean {
  return getStore().delete(fileId);
}

export function getExcelFilesByIds(fileIds: string[]): ExcelData[] | undefined {
  const files: ExcelData[] = [];
  for (const fileId of fileIds) {
    const data = getUploadData(fileId);
    if (!data) return undefined;
    files.push(data);
  }
  return files;
}
