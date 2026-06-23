export interface SheetData {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export type IndexStatus = "indexing" | "ready" | "error";

export type IndexPhase = "chunk" | "embed" | "done";

export interface IndexProgressState {
  phase: IndexPhase;
  percent: number;
  completed?: number;
  total?: number;
  chunkCount?: number;
}

export interface ExcelData {
  id: string;
  fileName: string;
  sheets: SheetData[];
  uploadedAt: string;
  indexStatus?: IndexStatus;
  indexError?: string;
  indexedChunks?: number;
  indexProgress?: IndexProgressState;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}
