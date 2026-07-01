import type { ExcelData, SheetData } from "./types";

const SESSION_TTL_MS = 15 * 60 * 1000;

interface PendingSheet {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

interface UploadSession {
  id: string;
  fileName: string;
  uploadedAt: string;
  sheets: PendingSheet[];
  createdAt: number;
}

type UploadSessionStore = Map<string, UploadSession>;

function getStore(): UploadSessionStore {
  const g = globalThis as typeof globalThis & { __uploadSessions?: UploadSessionStore };
  if (!g.__uploadSessions) g.__uploadSessions = new Map();
  return g.__uploadSessions;
}

function purgeExpiredSessions(): void {
  const store = getStore();
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of store) {
    if (session.createdAt < cutoff) store.delete(id);
  }
}

export interface UploadSheetMeta {
  name: string;
  headers: string[];
  rowCount: number;
}

export function createUploadSession(
  id: string,
  fileName: string,
  uploadedAt: string,
  sheets: UploadSheetMeta[]
): void {
  purgeExpiredSessions();
  getStore().set(id, {
    id,
    fileName,
    uploadedAt,
    sheets: sheets.map((sheet) => ({
      name: sheet.name,
      headers: sheet.headers,
      rows: [],
      rowCount: sheet.rowCount,
    })),
    createdAt: Date.now(),
  });
}

export function appendUploadChunk(
  uploadId: string,
  sheetName: string,
  rows: Record<string, unknown>[]
): string | null {
  purgeExpiredSessions();
  const session = getStore().get(uploadId);
  if (!session) return "업로드 세션이 만료되었습니다. 파일을 다시 올려 주세요.";

  const sheet = session.sheets.find((s) => s.name === sheetName);
  if (!sheet) return `시트 "${sheetName}"을 찾을 수 없습니다.`;

  sheet.rows.push(...rows);
  if (sheet.rows.length > sheet.rowCount) {
    return `시트 "${sheetName}" 행 수가 예상(${sheet.rowCount})을 초과했습니다.`;
  }
  return null;
}

export function finalizeUploadSession(uploadId: string): ExcelData | null {
  purgeExpiredSessions();
  const session = getStore().get(uploadId);
  if (!session) return null;

  for (const sheet of session.sheets) {
    if (sheet.rows.length !== sheet.rowCount) return null;
  }

  getStore().delete(uploadId);

  const sheets: SheetData[] = session.sheets.map((sheet) => ({
    name: sheet.name,
    headers: sheet.headers,
    rows: sheet.rows,
    rowCount: sheet.rowCount,
  }));

  return {
    id: session.id,
    fileName: session.fileName,
    sheets,
    uploadedAt: session.uploadedAt,
  };
}

export function discardUploadSession(uploadId: string): void {
  getStore().delete(uploadId);
}
