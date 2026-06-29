import { normalizeTextForMatch } from "./community-text-utils";
import { embedQuery } from "./embeddings";
import { getVectorStore, type DocumentChunk } from "./vector-store";

const DEFAULT_TOP_K = 24;
const DEFAULT_MIN_SCORE = 0.35;
const DEFAULT_KEYWORD_WEIGHT = 0.3;
const CANDIDATE_MULTIPLIER = 3;

export interface HybridSearchChunk extends DocumentChunk {
  score: number;
  vectorScore: number;
  keywordScore: number;
  matchedKeywords: string[];
}

export interface HybridSearchMeta {
  candidateCount: number;
  filteredCount: number;
  finalCount: number;
  topScore: number;
}

export interface HybridSearchResult {
  chunks: HybridSearchChunk[];
  meta: HybridSearchMeta;
}

function getBaseTopK(): number {
  const parsed = Number(process.env.RAG_TOP_K);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOP_K;
}

function getMinScore(): number {
  const parsed = Number(process.env.RAG_MIN_SCORE);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MIN_SCORE;
}

function getKeywordWeight(): number {
  const parsed = Number(process.env.RAG_HYBRID_KEYWORD_WEIGHT);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : DEFAULT_KEYWORD_WEIGHT;
}

export function getDynamicTopK(totalChunks: number): number {
  const base = getBaseTopK();
  if (totalChunks <= 0) return base;
  return Math.min(60, Math.max(base, Math.ceil(totalChunks * 2)));
}

function computeKeywordScore(
  chunk: DocumentChunk,
  keywords: string[]
): { score: number; matched: string[] } {
  if (keywords.length === 0) return { score: 0, matched: [] };

  const haystacks: string[] = [chunk.text, chunk.title ?? "", chunk.body ?? ""];
  if (chunk.citationRows) {
    for (const row of chunk.citationRows) {
      haystacks.push(row.title, row.body);
    }
  }

  const normalizedHaystack = normalizeTextForMatch(haystacks.join(" "));
  const matched: string[] = [];
  let titleBonus = 0;

  for (const keyword of keywords) {
    const normalizedKeyword = normalizeTextForMatch(keyword);
    if (!normalizedKeyword) continue;
    if (normalizedHaystack.includes(normalizedKeyword)) {
      matched.push(keyword);
      const titleHaystack = normalizeTextForMatch(
        [chunk.title ?? "", ...(chunk.citationRows?.map((r) => r.title) ?? [])].join(" ")
      );
      if (titleHaystack.includes(normalizedKeyword)) {
        titleBonus += 0.15;
      }
    }
  }

  const baseScore = matched.length / keywords.length;
  return { score: Math.min(1, baseScore + titleBonus), matched };
}

function isAdjacentChunk(a: DocumentChunk, b: DocumentChunk): boolean {
  return (
    a.fileId === b.fileId &&
    a.sheetName === b.sheetName &&
    Math.abs(a.rowIndex - b.rowIndex) <= 25
  );
}

function applyMmr(
  ranked: HybridSearchChunk[],
  limit: number
): HybridSearchChunk[] {
  const selected: HybridSearchChunk[] = [];
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    const isDuplicate = selected.some((picked) => isAdjacentChunk(picked, candidate));
    if (!isDuplicate) selected.push(candidate);
  }

  if (selected.length < limit) {
    for (const candidate of ranked) {
      if (selected.length >= limit) break;
      if (!selected.includes(candidate)) selected.push(candidate);
    }
  }

  return selected.slice(0, limit);
}

export async function searchRelevantChunksHybrid(
  fileIds: string[],
  query: string,
  keywords: string[] = []
): Promise<HybridSearchResult> {
  const store = getVectorStore();
  const indexedFileIds = fileIds.filter((id) => store.hasFile(id));

  if (!query.trim() || indexedFileIds.length === 0) {
    return {
      chunks: [],
      meta: { candidateCount: 0, filteredCount: 0, finalCount: 0, topScore: 0 },
    };
  }

  const totalChunks = store.getTotalChunkCount(indexedFileIds);
  const finalTopK = getDynamicTopK(totalChunks);
  const candidateTopK = finalTopK * CANDIDATE_MULTIPLIER;
  const minScore = getMinScore();
  const keywordWeight = getKeywordWeight();
  const vectorWeight = 1 - keywordWeight;

  const queryEmbedding = await embedQuery(query);
  const vectorCandidates = store.search(queryEmbedding, indexedFileIds, candidateTopK);

  const candidateMap = new Map<string, HybridSearchChunk>();

  for (const chunk of vectorCandidates) {
    const { score: keywordScore, matched } = computeKeywordScore(chunk, keywords);
    const finalScore = vectorWeight * chunk.score + keywordWeight * keywordScore;
    candidateMap.set(chunk.id, {
      ...chunk,
      vectorScore: chunk.score,
      keywordScore,
      matchedKeywords: matched,
      score: finalScore,
    });
  }

  if (keywords.length > 0) {
    const allChunks = store.getChunksForFiles(indexedFileIds);
    for (const chunk of allChunks) {
      const { score: keywordScore, matched } = computeKeywordScore(chunk, keywords);
      if (keywordScore <= 0) continue;

      const existing = candidateMap.get(chunk.id);
      const vectorScore = existing?.vectorScore ?? 0;
      const finalScore = vectorWeight * vectorScore + keywordWeight * keywordScore;

      if (!existing || finalScore > existing.score) {
        candidateMap.set(chunk.id, {
          ...chunk,
          vectorScore,
          keywordScore,
          matchedKeywords: matched,
          score: finalScore,
        });
      }
    }
  }

  const candidates = [...candidateMap.values()].sort((a, b) => b.score - a.score);
  const candidateCount = candidates.length;

  const topScore = candidates[0]?.score ?? 0;
  const relativeFloor = topScore > 0 ? topScore - 0.15 : 0;

  const filtered = candidates.filter(
    (chunk) => chunk.score >= minScore && chunk.score >= relativeFloor
  );
  const filteredCount = filtered.length;

  const mmrResults = applyMmr(filtered.length > 0 ? filtered : candidates, finalTopK);

  return {
    chunks: mmrResults,
    meta: {
      candidateCount,
      filteredCount,
      finalCount: mmrResults.length,
      topScore: mmrResults[0]?.score ?? 0,
    },
  };
}
