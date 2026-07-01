import { generateText, type LanguageModel } from "ai";
import { collectCommunitySheets } from "./community-analysis";
import { collectKnownKeywordsFromData } from "./community-text-utils";
import type {
  CommunityQueryIntent,
  CommunityQueryIntentType,
} from "./community-query-intent";
import type { ExcelData } from "./types";

export type CommunityApproach =
  | "semantic_rag"
  | "keyword_aggregation"
  | "aggregation_and_rag"
  | "verbatim_quote"
  | "source_lookup";

export interface CommunityQueryPlan {
  approach: CommunityApproach;
  reasoning: string;
  aggregationKeywords: string[];
  searchPhrases: string[];
  labelFilter: string | null;
  dateFilter: string | null;
  limit: number | null;
}

const APPROACH_LABELS: Record<CommunityApproach, string> = {
  semantic_rag: "본문 의미 분석 (RAG)",
  keyword_aggregation: "키워드 전수 집계",
  aggregation_and_rag: "집계 + 본문 요약",
  verbatim_quote: "원문 인용",
  source_lookup: "출처 추적",
};

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed || trimmed.length < 2) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function parsePlanFromText(text: string): Partial<CommunityQueryPlan> | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const approach = raw.approach;
    if (typeof approach !== "string") return null;

    const validApproaches: CommunityApproach[] = [
      "semantic_rag",
      "keyword_aggregation",
      "aggregation_and_rag",
      "verbatim_quote",
      "source_lookup",
    ];
    if (!validApproaches.includes(approach as CommunityApproach)) return null;

    return {
      approach: approach as CommunityApproach,
      reasoning: typeof raw.reasoning === "string" ? raw.reasoning.trim() : "",
      aggregationKeywords: Array.isArray(raw.aggregationKeywords)
        ? raw.aggregationKeywords.filter((k): k is string => typeof k === "string")
        : [],
      searchPhrases: Array.isArray(raw.searchPhrases)
        ? raw.searchPhrases.filter((p): p is string => typeof p === "string")
        : [],
      labelFilter: typeof raw.labelFilter === "string" ? raw.labelFilter : null,
      dateFilter: typeof raw.dateFilter === "string" ? raw.dateFilter : null,
      limit: typeof raw.limit === "number" && raw.limit > 0 ? raw.limit : null,
    };
  } catch {
    return null;
  }
}

function defaultSemanticPlan(): CommunityQueryPlan {
  return {
    approach: "semantic_rag",
    reasoning: "질문 맥락을 게시글 본문에서 찾아 답변합니다.",
    aggregationKeywords: [],
    searchPhrases: [],
    labelFilter: null,
    dateFilter: null,
    limit: null,
  };
}

function sanitizeAggregationKeywords(
  keywords: string[],
  knownKeywords: string[]
): string[] {
  const known = new Set(knownKeywords.map((k) => k.toLowerCase()));
  return uniqueStrings(
    keywords.filter((keyword) => {
      const lower = keyword.toLowerCase();
      if (known.has(lower)) return true;
      return knownKeywords.some(
        (knownKw) => knownKw.includes(keyword) || keyword.includes(knownKw)
      );
    })
  );
}

export function planToCommunityIntent(plan: CommunityQueryPlan): CommunityQueryIntent {
  const base = {
    keywords: plan.aggregationKeywords,
    searchPhrases: plan.searchPhrases,
    labelFilter: plan.labelFilter,
    dateFilter: plan.dateFilter,
    limit: plan.limit,
    includeSummaryRag: false,
  };

  const typeMap: Record<CommunityApproach, CommunityQueryIntentType> = {
    semantic_rag: "community_summary",
    keyword_aggregation: "community_count",
    aggregation_and_rag: "community_count_and_summary",
    verbatim_quote: "community_quote",
    source_lookup: "community_source_lookup",
  };

  const type = typeMap[plan.approach];

  if (plan.approach === "semantic_rag" || plan.approach === "aggregation_and_rag") {
    base.includeSummaryRag = true;
  }

  if (plan.approach === "semantic_rag") {
    base.keywords = [];
  }

  if (plan.approach === "verbatim_quote" && base.limit === null) {
    base.limit = 20;
  }
  if (plan.approach === "source_lookup" && base.limit === null) {
    base.limit = 15;
  }

  return { type, ...base };
}

export function approachLabel(approach: CommunityApproach): string {
  return APPROACH_LABELS[approach];
}

export interface ClassifyCommunityQueryOptions {
  files: ExcelData[];
  knownKeywords?: string[];
  fileNames?: string[];
  totalCommunityRows?: number;
}

/**
 * 사용자 질문의 **맥락**을 LLM이 읽고 분석 방식을 결정합니다.
 * 질문 속 단어 매칭·정규식 라우팅은 사용하지 않습니다.
 */
export async function classifyCommunityQuery(
  model: LanguageModel,
  userQuery: string,
  options: ClassifyCommunityQueryOptions
): Promise<{ plan: CommunityQueryPlan; intent: CommunityQueryIntent }> {
  const query = userQuery.trim();
  if (!query) {
    const plan = defaultSemanticPlan();
    return { plan, intent: planToCommunityIntent(plan) };
  }

  const sheets = collectCommunitySheets(options.files);
  const knownKeywords =
    options.knownKeywords ?? collectKnownKeywordsFromData(sheets);
  const knownSample = knownKeywords.slice(0, 40).join(", ") || "(없음)";
  const fileNames =
    options.fileNames ?? options.files.map((file) => file.fileName);
  const totalRows =
    options.totalCommunityRows ??
    sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);

  if (process.env.CHAT_SKIP_COMMUNITY_ROUTER === "true") {
    const plan = defaultSemanticPlan();
    return { plan, intent: planToCommunityIntent(plan) };
  }

  try {
    const { text } = await generateText({
      model,
      temperature: 0,
      prompt: `당신은 커뮤니티 게시글 데이터 분석 챗봇의 **질문 라우터**입니다.
사용자 질문의 **의도와 맥락**만 읽고, 어떤 데이터 준비 방식이 맞는지 JSON으로 결정하세요.

## 데이터 개요
- 파일: ${fileNames.join(", ") || "(없음)"}
- 커뮤니티 게시글 약 ${totalRows.toLocaleString()}행
- 데이터에 등록된 키워드 예시 (집계 대상 후보): ${knownSample}

## 분석 방식 (approach) — 하나만 선택

1. **semantic_rag** (기본·가장 흔함)
   - 관심사·니즈·선물·여론·불만·왜·무엇을 원하는지 등 **의미를 이해해** 게시글 본문으로 답해야 할 때
   - 질문에 특정 단어가 있다고 해서 이 방식을 쓰면 안 됩니다

2. **keyword_aggregation**
   - 사용자가 **몇 건·언급 횟수·일별/월별 추이·비율·차트·분포** 등 **정확한 숫자 집계**를 핵심으로 요청할 때만
   - 질문 속 단어(선물, 진짜, 관심 등)의 **출현 빈도**를 세라는 질문에는 절대 사용하지 마세요

3. **aggregation_and_rag**
   - 숫자 집계 **와** 여론·맥락 해석 **둘 다** 명확히 필요할 때

4. **verbatim_quote**
   - 원문·인용문을 **그대로** 보여달라고 할 때

5. **source_lookup**
   - 붙여넣은 문장·구절의 **출처(게시글)** 를 찾을 때

## 필드
- reasoning: 한국어로 1문장 (왜 이 방식인지)
- aggregationKeywords: keyword_aggregation / aggregation_and_rag 일 때만. 집계할 **브랜드·주제명** (조사·어미·질문어 금지). 데이터 키워드 예시와 맞으면 좋음
- searchPhrases: source_lookup 일 때 검색할 구절 배열
- labelFilter: "긍정"|"부정"|"중립" 또는 null
- dateFilter: "YYYY-MM-DD" 또는 null
- limit: 원문/출처 검색 최대 건수 또는 null

## 사용자 질문
${query}

## 출력 (JSON만, 다른 텍스트 금지)
{"approach":"semantic_rag","reasoning":"...","aggregationKeywords":[],"searchPhrases":[],"labelFilter":null,"dateFilter":null,"limit":null}`,
    });

    const parsed = parsePlanFromText(text);
    if (!parsed?.approach) {
      const plan = defaultSemanticPlan();
      return { plan, intent: planToCommunityIntent(plan) };
    }

    const plan: CommunityQueryPlan = {
      approach: parsed.approach,
      reasoning: parsed.reasoning || APPROACH_LABELS[parsed.approach],
      aggregationKeywords: sanitizeAggregationKeywords(
        parsed.aggregationKeywords ?? [],
        knownKeywords
      ),
      searchPhrases: uniqueStrings(parsed.searchPhrases ?? []),
      labelFilter: parsed.labelFilter ?? null,
      dateFilter: parsed.dateFilter ?? null,
      limit: parsed.limit ?? null,
    };

    if (
      (plan.approach === "keyword_aggregation" ||
        plan.approach === "aggregation_and_rag") &&
      plan.aggregationKeywords.length === 0
    ) {
      plan.approach = "semantic_rag";
      plan.reasoning =
        "집계 대상 키워드를 특정할 수 없어 본문 의미 분석으로 전환합니다.";
    }

    return { plan, intent: planToCommunityIntent(plan) };
  } catch (error) {
    console.error("Community query router failed:", error);
    const plan = defaultSemanticPlan();
    plan.reasoning = "라우터 오류 — 기본 본문 분석으로 진행합니다.";
    return { plan, intent: planToCommunityIntent(plan) };
  }
}
