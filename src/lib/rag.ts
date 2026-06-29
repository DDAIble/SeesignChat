import { chunkExcelFile, type ChunkDraft } from "./chunking";
import type { CitationSource } from "./citations";
import { embedTexts } from "./embeddings";
import {
  getDynamicTopK,
  searchRelevantChunksHybrid,
  type HybridSearchChunk,
  type HybridSearchMeta,
} from "./hybrid-search";
import { getVectorStore, type DocumentChunk } from "./vector-store";
import type { ExcelData } from "./types";

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
  chunks: HybridSearchChunk[];
  contextText: string;
  citations: CitationSource[];
  meta: HybridSearchMeta;
}

export async function searchRelevantChunks(
  fileIds: string[],
  query: string,
  keywords: string[] = []
): Promise<RAGSearchResult> {
  const store = getVectorStore();
  const indexedFileIds = fileIds.filter((id) => store.hasFile(id));

  if (!query.trim() || indexedFileIds.length === 0) {
    return {
      chunks: [],
      contextText: "",
      citations: [],
      meta: { candidateCount: 0, filteredCount: 0, finalCount: 0, topScore: 0 },
    };
  }

  const hybrid = await searchRelevantChunksHybrid(indexedFileIds, query, keywords);
  const contextText = formatRAGContext(hybrid.chunks, hybrid.meta);
  const citations = buildCitationsFromChunks(hybrid.chunks);

  return {
    chunks: hybrid.chunks,
    contextText,
    citations,
    meta: hybrid.meta,
  };
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

    const hasCells = rows.some((row) => row.cells && Object.keys(row.cells).length > 0);

    return {
      index: index + 1,
      fileName: chunk.fileName,
      sheetName: chunk.sheetName,
      rowIndex: chunk.rowIndex,
      rowEnd: chunk.rowEnd,
      title: chunk.title || `${chunk.fileName} / ${chunk.sheetName}`,
      body: chunk.body || chunk.text.slice(0, 500),
      rows,
      headers: hasCells ? chunk.headers : undefined,
    };
  });
}

function formatRAGContext(
  chunks: HybridSearchChunk[],
  meta: HybridSearchMeta
): string {
  if (chunks.length === 0) {
    return "";
  }

  const parts = [
    "### 질문 관련 검색 결과 (하이브리드 RAG)",
    "",
    `- 벡터 유사도 + 키워드 매칭으로 **${chunks.length}건** 선별 (후보 ${meta.candidateCount}건 → 필터 ${meta.filteredCount}건)`,
    "- 아래 청크 **텍스트만** 근거로 답변하세요. 없는 내용은 추측하지 마세요.",
    "- **건수·통계·비율** 질문은 **커뮤니티 키워드 집계** 섹션만 사용하고, RAG 청크로 숫자를 만들지 마세요.",
    "",
  ];

  chunks.forEach((chunk, index) => {
    const rowLabel =
      chunk.rowEnd > chunk.rowIndex
        ? `행 ${chunk.rowIndex}~${chunk.rowEnd}`
        : `행 ${chunk.rowIndex}`;
    const keywordNote =
      chunk.matchedKeywords.length > 0
        ? ` · 키워드: ${chunk.matchedKeywords.join(", ")}`
        : "";
    parts.push(
      `#### [${index + 1}] ${chunk.fileName} / ${chunk.sheetName} / ${rowLabel} (점수 ${chunk.score.toFixed(3)} · 벡터 ${chunk.vectorScore.toFixed(3)} · 키워드 ${chunk.keywordScore.toFixed(3)}${keywordNote})`,
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
    .map((id) => {
      const count = store.getFileChunkCount(id);
      const topK = getDynamicTopK(count);
      return `- 인덱싱됨: **${count.toLocaleString()}청크** (검색 topK 최대 ${topK})`;
    });

  if (lines.length === 0) {
    return "⚠️ 아직 임베딩 인덱스가 없습니다. 파일 업로드 후 인덱싱이 완료될 때까지 기다려 주세요.";
  }

  return lines.join("\n");
}

export type { ChunkDraft };
