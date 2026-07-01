/**
 * 커뮤니티 질의 라우터·의도 매핑 수동 검증 (규칙 기반 아님 — plan → intent)
 * 실행: npx tsx src/lib/community-query-intent.verify.ts
 */
import {
  isCommunityCountIntent,
  shouldUseSummaryRag,
} from "./community-query-intent";
import {
  planToCommunityIntent,
  type CommunityQueryPlan,
} from "./community-query-router";

interface Case {
  name: string;
  plan: CommunityQueryPlan;
  expectType: string;
  expectCount: boolean;
  expectRag: boolean;
}

const CASES: Case[] = [
  {
    name: "정성 — 관심사·선물 (semantic_rag)",
    plan: {
      approach: "semantic_rag",
      reasoning: "관심사와 선물 니즈를 본문에서 파악해야 함",
      aggregationKeywords: [],
      searchPhrases: [],
      labelFilter: null,
      dateFilter: null,
      limit: null,
    },
    expectType: "community_summary",
    expectCount: false,
    expectRag: true,
  },
  {
    name: "건수 — 대성 언급",
    plan: {
      approach: "keyword_aggregation",
      reasoning: "대성 키워드 언급 건수 집계 요청",
      aggregationKeywords: ["대성"],
      searchPhrases: [],
      labelFilter: null,
      dateFilter: null,
      limit: null,
    },
    expectType: "community_count",
    expectCount: true,
    expectRag: false,
  },
  {
    name: "건수 — 일별 추이",
    plan: {
      approach: "keyword_aggregation",
      reasoning: "일별 추이 그래프는 숫자 집계 필요",
      aggregationKeywords: ["선물"],
      searchPhrases: [],
      labelFilter: null,
      dateFilter: null,
      limit: null,
    },
    expectType: "community_count",
    expectCount: true,
    expectRag: false,
  },
  {
    name: "정성 — 여론 요약",
    plan: {
      approach: "semantic_rag",
      reasoning: "긍정 여론 요약은 본문 의미 분석",
      aggregationKeywords: [],
      searchPhrases: [],
      labelFilter: "긍정",
      dateFilter: null,
      limit: null,
    },
    expectType: "community_summary",
    expectCount: false,
    expectRag: true,
  },
  {
    name: "원문 인용",
    plan: {
      approach: "verbatim_quote",
      reasoning: "원문 그대로 보여달라는 요청",
      aggregationKeywords: [],
      searchPhrases: [],
      labelFilter: null,
      dateFilter: null,
      limit: null,
    },
    expectType: "community_quote",
    expectCount: false,
    expectRag: false,
  },
  {
    name: "일반 탐색 — 브랜드 불만",
    plan: {
      approach: "semantic_rag",
      reasoning: "브랜드에 대한 여론을 본문에서 찾아야 함",
      aggregationKeywords: [],
      searchPhrases: [],
      labelFilter: null,
      dateFilter: null,
      limit: null,
    },
    expectType: "community_summary",
    expectCount: false,
    expectRag: true,
  },
];

let failed = 0;

for (const testCase of CASES) {
  const intent = planToCommunityIntent(testCase.plan);
  const isCount = isCommunityCountIntent(intent.type);
  const useRag = shouldUseSummaryRag(intent);

  const typeOk = intent.type === testCase.expectType;
  const countOk = isCount === testCase.expectCount;
  const ragOk = useRag === testCase.expectRag;

  if (typeOk && countOk && ragOk) {
    console.log(`OK  ${testCase.name} → ${intent.type}`);
  } else {
    failed += 1;
    console.error(`FAIL ${testCase.name}`);
    console.error(`  type: ${intent.type} (expected ${testCase.expectType})`);
    console.error(`  count: ${isCount} (expected ${testCase.expectCount})`);
    console.error(`  rag: ${useRag} (expected ${testCase.expectRag})`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}

console.log(`\nAll ${CASES.length} cases passed`);
