import type { ChunkDataType } from "./chunking";
import type { CitationRowData } from "./citations";

export interface DocumentChunk {
  id: string;
  fileId: string;
  fileName: string;
  sheetName: string;
  rowIndex: number;
  rowEnd: number;
  text: string;
  title?: string;
  body?: string;
  citationRows?: CitationRowData[];
  dataType: ChunkDataType;
  embedding: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

class VectorStore {
  private chunks = new Map<string, DocumentChunk>();
  private fileChunkIds = new Map<string, Set<string>>();

  hasFile(fileId: string): boolean {
    return this.fileChunkIds.has(fileId);
  }

  getFileChunkCount(fileId: string): number {
    return this.fileChunkIds.get(fileId)?.size ?? 0;
  }

  addChunks(chunks: DocumentChunk[]): void {
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk);
      const ids = this.fileChunkIds.get(chunk.fileId) ?? new Set<string>();
      ids.add(chunk.id);
      this.fileChunkIds.set(chunk.fileId, ids);
    }
  }

  removeFile(fileId: string): number {
    const ids = this.fileChunkIds.get(fileId);
    if (!ids) return 0;

    for (const id of ids) {
      this.chunks.delete(id);
    }
    this.fileChunkIds.delete(fileId);
    return ids.size;
  }

  search(
    queryEmbedding: number[],
    fileIds: string[],
    topK: number
  ): Array<DocumentChunk & { score: number }> {
    const allowed = new Set(fileIds);
    const results: Array<DocumentChunk & { score: number }> = [];

    for (const chunk of this.chunks.values()) {
      if (!allowed.has(chunk.fileId)) continue;
      results.push({
        ...chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }
}

const globalForVectorStore = globalThis as unknown as {
  __excelAiVectorStore?: VectorStore;
};

export function getVectorStore(): VectorStore {
  if (!globalForVectorStore.__excelAiVectorStore) {
    globalForVectorStore.__excelAiVectorStore = new VectorStore();
  }
  return globalForVectorStore.__excelAiVectorStore;
}
