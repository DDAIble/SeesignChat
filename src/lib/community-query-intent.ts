import { collectCommunitySheets } from "./community-analysis";
import {
  collectKnownKeywordsFromData,
  extractDateFilterFromQuery,
} from "./community-text-utils";
import type { ExcelData } from "./types";

export type CommunityQueryIntentType =
  | "community_count"
  | "community_count_and_summary"
  | "community_quote"
  | "community_summary"
  | "other";

export interface CommunityQueryIntent {
  type: CommunityQueryIntentType;
  keywords: string[];
  labelFilter: string | null;
  dateFilter: string | null;
  limit: number | null;
  /** count+summary 혼합 질문 시 RAG(여론) 병행 */
  includeSummaryRag: boolean;
}

const COUNT_RE =
  /건수|몇\s*건|몇건|count|통계|집계|합산|총\s*\d|언급\s*(횟수|건|수)|일별|월별|주별|날짜별|며칠|그래프|차트|추이|비율|분포|heatmap|히트맵/i;

const QUOTE_RE =
  /원글|원문|인용|그대로|실제\s*문구|본문\s*보여|글\s*보여|게시글\s*보여|문구\s*보여|텍스트\s*보여|아래\s*게시글|아래\s*문장/i;

const SUMMARY_RE =
  /여론|주제|반응|니즈|욕구|불만|칭찬|맥락|요약|분석|인사이트|왜|느낌|경향|페르소나|아바타|어때|어떤지|많아|많은지/i;

const LABEL_RE = /(긍정|부정|중립|neutral|positive|negative)/i;

const QUOTED_STRING_RE = /['"「『]([^'"」』]{2,40})['"」』]/g;

const KEYWORD_CONTEXT_RE =
  /([가-힣A-Za-z0-9]{2,8})\s*(?:언급|건수|원글|원문|긍정|부정|몇\s*건|통계|그래프|차트)/;

const LIMIT_RE = /(\d+)\s*(?:개|건|곳|명|줄)?\s*(?:보여|보기|추출|가져|출력|인용|원글|원문)/;

function uniqueKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (!trimmed || trimmed.length < 2) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function extractKeywordsFromQuery(query: string, knownKeywords: string[]): string[] {
  const found: string[] = [];

  for (const match of query.matchAll(QUOTED_STRING_RE)) {
    if (match[1]) found.push(match[1]);
  }

  const contextMatch = query.match(KEYWORD_CONTEXT_RE);
  if (contextMatch?.[1]) found.push(contextMatch[1]);

  for (const known of knownKeywords) {
    if (query.includes(known)) found.push(known);
  }

  const koreanNameMatches = query.match(/[가-힣]{2,6}/g) ?? [];
  const stopWords = new Set([
    "원글",
    "원문",
    "인용",
    "게시글",
    "보여줘",
    "보여",
    "몇건",
    "건수",
    "통계",
    "그래프",
    "일별",
    "월별",
    "긍정",
    "부정",
    "아래",
    "작성",
    "분류",
    "데이터",
    "확인",
    "검증",
    "언급",
    "수험생",
    "강사",
    "커뮤니티",
    "여론",
    "반응",
    "어때",
    "분석",
    "요약",
    "경향",
    "주제",
  ]);
  for (const token of koreanNameMatches) {
    if (!stopWords.has(token) && token.length >= 2 && token.length <= 6) {
      found.push(token);
    }
  }

  return uniqueKeywords(found);
}

function extractLabelFilter(query: string): string | null {
  const match = query.match(LABEL_RE);
  if (!match) return null;
  const label = match[1].toLowerCase();
  if (label === "positive") return "긍정";
  if (label === "negative") return "부정";
  if (label === "neutral") return "중립";
  return match[1];
}

function extractLimit(query: string): number | null {
  const match = query.match(LIMIT_RE);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function baseIntent(
  partial: Omit<CommunityQueryIntent, "includeSummaryRag"> & { includeSummaryRag?: boolean }
): CommunityQueryIntent {
  return {
    includeSummaryRag: partial.includeSummaryRag ?? false,
    ...partial,
  };
}

export function detectCommunityQueryIntent(
  query: string,
  files: ExcelData[],
  hasCommunityRows: boolean
): CommunityQueryIntent {
  const defaultIntent: CommunityQueryIntent = {
    type: "other",
    keywords: [],
    labelFilter: null,
    dateFilter: null,
    limit: null,
    includeSummaryRag: false,
  };

  if (!hasCommunityRows || !query.trim()) return defaultIntent;

  const sheets = collectCommunitySheets(files);
  const knownKeywords = collectKnownKeywordsFromData(sheets);
  const keywords = extractKeywordsFromQuery(query, knownKeywords);
  const labelFilter = extractLabelFilter(query);
  const dateFilter = extractDateFilterFromQuery(query);
  const limit = extractLimit(query);

  const isQuote = QUOTE_RE.test(query);
  const isCount = COUNT_RE.test(query);
  const isSummary = SUMMARY_RE.test(query);
  const hasCountHint = keywords.length > 0 && /언급|몇|건|수|그래프|차트/.test(query);

  if (isQuote) {
    return baseIntent({
      type: "community_quote",
      keywords,
      labelFilter,
      dateFilter,
      limit: limit ?? 20,
    });
  }

  // 통계(COUNT) 우선 — SUMMARY와 혼합 시 집계 + RAG 병행
  if (isCount && isSummary) {
    return baseIntent({
      type: "community_count_and_summary",
      keywords,
      labelFilter,
      dateFilter,
      limit: null,
      includeSummaryRag: true,
    });
  }

  if (isCount || hasCountHint) {
    return baseIntent({
      type: "community_count",
      keywords,
      labelFilter,
      dateFilter,
      limit: null,
    });
  }

  if (isSummary) {
    return baseIntent({
      type: "community_summary",
      keywords,
      labelFilter,
      dateFilter,
      limit: null,
      includeSummaryRag: true,
    });
  }

  if (keywords.length > 0) {
    return baseIntent({
      type: "community_count",
      keywords,
      labelFilter,
      dateFilter,
      limit: null,
    });
  }

  if (COUNT_RE.test(query)) {
    return baseIntent({
      type: "community_count",
      keywords,
      labelFilter,
      dateFilter,
      limit: null,
    });
  }

  return defaultIntent;
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
