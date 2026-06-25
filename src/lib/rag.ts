import { chunkExcelFile, type ChunkDraft } from "./chunking";
import type { CitationSource } from "./citations";
import { embedQuery, embedTexts } from "./embeddings";
import { getVectorStore, type DocumentChunk } from "./vector-store";
import type { ExcelData } from "./types";

const DEFAULT_TOP_K = 24;

export interface IndexProgress {
  phase: "chunk" | "embed" | "done";
  completed: number;
  total: number;
  chunkCount: number;
}

export interface IndexResult {
  fileId: string;
  chunkCount: number;
  skipped: boolean;
}

function getTopK(): number {
  const parsed = Number(process.env.RAG_TOP_K);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOP_K;
}

export function isFileIndexed(fileId: string): boolean {
  return getVectorStore().hasFile(fileId);
}

export function removeFileIndex(fileId: string): number {
  return getVectorStore().removeFile(fileId);
}

export async function ensureFilesIndexed(files: ExcelData[]): Promise<void> {
  for (const file of files) {
    if (!isFileIndexed(file.id)) {
      await indexExcelFile(file);
    }
  }
}

export async function indexExcelFile(
  data: ExcelData,
  onProgress?: (progress: IndexProgress) => void
): Promise<IndexResult> {
  const store = getVectorStore();

  if (store.hasFile(data.id)) {
    return {
      fileId: data.id,
      chunkCount: store.getFileChunkCount(data.id),
      skipped: true,
    };
  }

  const drafts = chunkExcelFile(data);
  onProgress?.({
    phase: "chunk",
    completed: 0,
    total: 1,
    chunkCount: 0,
  });
  onProgress?.({
    phase: "chunk",
    completed: 1,
    total: 1,
    chunkCount: drafts.length,
  });

  if (drafts.length === 0) {
    onProgress?.({
      phase: "done",
      completed: 1,
      total: 1,
      chunkCount: 0,
    });
    return { fileId: data.id, chunkCount: 0, skipped: false };
  }

  const texts = drafts.map((draft) => draft.text);
  const embedBatchTotal = Math.ceil(texts.length / (Number(process.env.RAG_EMBED_BATCH_SIZE) || 100));
  onProgress?.({
    phase: "embed",
    completed: 0,
    total: embedBatchTotal,
    chunkCount: drafts.length,
  });

  const embeddings = await embedTexts(texts, "RETRIEVAL_DOCUMENT", (completed, total) => {
    onProgress?.({
      phase: "embed",
      completed,
      total,
      chunkCount: drafts.length,
    });
  });

  const chunks: DocumentChunk[] = drafts.map((draft, index) => ({
    ...draft,
    embedding: embeddings[index],
  }));

  store.addChunks(chunks);

  onProgress?.({
    phase: "done",
    completed: drafts.length,
    total: drafts.length,
    chunkCount: drafts.length,
  });

  return { fileId: data.id, chunkCount: chunks.length, skipped: false };
}

export interface RAGSearchResult {
  chunks: Array<DocumentChunk & { score: number }>;
  contextText: string;
  citations: CitationSource[];
}

export async function searchRelevantChunks(
  fileIds: string[],
  query: string,
  topK = getTopK()
): Promise<RAGSearchResult> {
  const store = getVectorStore();
  const indexedFileIds = fileIds.filter((id) => store.hasFile(id));

  if (!query.trim() || indexedFileIds.length === 0) {
    return { chunks: [], contextText: "", citations: [] };
  }

  const queryEmbedding = await embedQuery(query);
  const chunks = store.search(queryEmbedding, indexedFileIds, topK);
  const contextText = formatRAGContext(chunks);
  const citations = buildCitationsFromChunks(chunks);

  return { chunks, contextText, citations };
}

export function buildCitationsFromChunks(
  chunks: Array<DocumentChunk & { score: number }>
): CitationSource[] {
  return chunks.map((chunk, index) => {
    const rows =
      chunk.citationRows && chunk.citationRows.length > 0
        ? chunk.citationRows
        : [
            {
              rowIndex: chunk.rowIndex,
              title: chunk.title || "-",
              body: chunk.body || chunk.text.slice(0, 500),
              date: "",
              community: "",
            },
          ];

    return {
      index: index + 1,
      fileName: chunk.fileName,
      sheetName: chunk.sheetName,
      rowIndex: chunk.rowIndex,
      rowEnd: chunk.rowEnd,
      title: chunk.title || `${chunk.fileName} / ${chunk.sheetName}`,
      body: chunk.body || chunk.text.slice(0, 500),
      rows,
    };
  });
}

function formatRAGContext(chunks: Array<DocumentChunk & { score: number }>): string {
  if (chunks.length === 0) {
    return "";
  }

  const parts = [
    "### 질문 관련 검색 결과 (RAG)",
    "",
    `질문과 의미적으로 가장 가까운 **${chunks.length}건**의 행을 임베딩 검색으로 찾았습니다.`,
    "아래 내용만 근거로 답변하고, 검색 결과에 없는 내용은 추측하지 마세요.",
    "",
  ];

  chunks.forEach((chunk, index) => {
    const rowLabel =
      chunk.rowEnd > chunk.rowIndex
        ? `행 ${chunk.rowIndex}~${chunk.rowEnd}`
        : `행 ${chunk.rowIndex}`;
    parts.push(
      `#### [${index + 1}] ${chunk.fileName} / ${chunk.sheetName} / ${rowLabel} (유사도 ${chunk.score.toFixed(3)})`,
      chunk.text,
      ""
    );
  });

  return parts.join("\n");
}

export function getIndexedFileSummary(fileIds: string[]): string {
  const store = getVectorStore();
  const lines = fileIds
    .filter((id) => store.hasFile(id))
    .map((id) => `- 인덱싱됨: **${store.getFileChunkCount(id).toLocaleString()}청크**`);

  if (lines.length === 0) {
    return "⚠️ 아직 임베딩 인덱스가 없습니다. 파일 업로드 후 인덱싱이 완료될 때까지 기다려 주세요.";
  }

  return lines.join("\n");
}
