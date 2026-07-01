import type { ExcelData } from "./types";

export type CommunityQueryIntentType =
  | "community_count"
  | "community_count_and_summary"
  | "community_quote"
  | "community_source_lookup"
  | "community_summary"
  | "other";

export interface CommunityQueryIntent {
  type: CommunityQueryIntentType;
  keywords: string[];
  /** 출처 추적 질문에서 검색할 구절 (긴 붙여넣기·쉼표 구분) */
  searchPhrases: string[];
  labelFilter: string | null;
  dateFilter: string | null;
  limit: number | null;
  /** count+summary 혼합 질문 시 RAG(여론) 병행 */
  includeSummaryRag: boolean;
}

const EMPTY_INTENT: CommunityQueryIntent = {
  type: "other",
  keywords: [],
  searchPhrases: [],
  labelFilter: null,
  dateFilter: null,
  limit: null,
  includeSummaryRag: false,
};

/** 커뮤니티 데이터가 없을 때 */
export function emptyCommunityQueryIntent(): CommunityQueryIntent {
  return { ...EMPTY_INTENT };
}

/**
 * RAG 보조 키워드 — 벡터 검색이 질문 전체를 쓰므로 intent에 키워드가 없으면 빈 배열.
 */
export function resolveRagSearchTerms(intent: CommunityQueryIntent): string[] {
  return intent.keywords;
}

/** @deprecated LLM 라우터 사용 — 하위 호환용 */
export function extractKeywordsFromQuery(
  _query: string,
  _knownKeywords: string[]
): string[] {
  return [];
}

export function isCommunityCountIntent(type: CommunityQueryIntentType): boolean {
  return type === "community_count" || type === "community_count_and_summary";
}

export function shouldUseSummaryRag(intent: CommunityQueryIntent): boolean {
  return (
    intent.includeSummaryRag ||
    intent.type === "community_summary" ||
    intent.type === "community_count_and_summary"
  );
}

/** @deprecated classifyCommunityQuery (LLM) 사용 */
export function detectCommunityQueryIntent(
  _query: string,
  _files: ExcelData[],
  hasCommunityRows: boolean
): CommunityQueryIntent {
  if (!hasCommunityRows) return emptyCommunityQueryIntent();
  return {
    type: "community_summary",
    keywords: [],
    searchPhrases: [],
    labelFilter: null,
    dateFilter: null,
    limit: null,
    includeSummaryRag: true,
  };
}
