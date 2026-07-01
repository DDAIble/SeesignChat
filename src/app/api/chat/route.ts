import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { APICallError } from "ai";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  generateText,
  streamText,
  UIMessage,
} from "ai";
import { createAnalysisTraceEmitter } from "@/lib/analysis-trace";
import { buildCommunityAggregationReport } from "@/lib/community-aggregation";
import { collectCommunitySheets, sheetLooksLikeCommunityPosts } from "@/lib/community-analysis";
import { collectKnownKeywordsFromData } from "@/lib/community-text-utils";
import { detectCommunityQueryIntent, extractKeywordsFromQuery, isCommunityCountIntent, shouldUseSummaryRag } from "@/lib/community-query-intent";
import { searchCommunityRowsByPhrases } from "@/lib/community-phrase-search";
import {
  buildCommunityCorpus,
  searchCommunityRows,
} from "@/lib/community-row-search";
import {
  appendCommunityAggregationContext,
  appendCommunityQuoteContext,
  appendCommunitySourceLookupContext,
  appendQuantitativeContext,
  appendRAGContext,
  buildAIContext,
} from "@/lib/excel";
import { generateFollowUpQuestions } from "@/lib/follow-up-questions";
import {
  buildQuantitativeReport,
  isQuantitativeAnalysisQuery,
} from "@/lib/quantitative-analysis";
import {
  QUOTE_DISCLAIMER,
  SUMMARY_CLAIM_DISCLAIMER,
  VERBATIM_RETRY_SUFFIX,
  verifyQuotesInAnswer,
  verifySummaryClaims,
} from "@/lib/quote-verification";
import { searchRelevantChunks } from "@/lib/rag";
import { sheetLooksLikeQA } from "@/lib/qa-location";
import type { ExcelData } from "@/lib/types";
import type { CitationSource } from "@/lib/citations";

/** 통합 인용 인덱스 공간 — 경로별 충돌 방지 (parseEvidence는 최대 3자리=999까지 허용) */
const AGG_CITATION_BASE = 300;
const QUANT_CITATION_BASE = 600;

const TOKEN_LIMIT_MESSAGE =
  "데이터가 너무 커서 AI 입력 한도를 초과했습니다. 파일 수를 줄여주세요.";
const GENERIC_ANSWER_ERROR_MESSAGE =
  "답변을 생성하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
const SOURCE_LOOKUP_DISCLAIMER =
  "> **안내**: 아래 답변의 일부 인용이 업로드된 원문과 정확히 일치하지 않습니다. 동일 원문이 없거나 AI가 요약·합성한 표현일 수 있으니, 출처가 중요하면 해당 문장을 다시 확인해 주세요.\n\n";

/** Gemini 토큰 한도 초과 여부 — 메시지 문구 변경에 견디도록 상태코드도 확인 */
function isTokenLimitError(error: unknown): boolean {
  if (!APICallError.isInstance(error)) return false;
  const message = (error.message ?? "").toLowerCase();
  if (
    message.includes("token count exceeds") ||
    message.includes("maximum number of tokens") ||
    message.includes("input token") ||
    message.includes("request payload size") ||
    message.includes("exceeds the maximum")
  ) {
    return true;
  }
  return error.statusCode === 413;
}

export const maxDuration = 300;

const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";

function getUserMessageTexts(messages: UIMessage[]): string[] {
  return messages
    .filter((message) => message.role === "user")
    .map((message) =>
      message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("")
    )
    .filter((text) => text.trim().length > 0);
}

function getLatestUserQuery(messages: UIMessage[]): string {
  const texts = getUserMessageTexts(messages);
  return texts[texts.length - 1] ?? "";
}

function summarizeUploads(excelFiles: ExcelData[]) {
  let totalRows = 0;
  let communityRows = 0;
  let qaRows = 0;

  for (const file of excelFiles) {
    for (const sheet of file.sheets) {
      totalRows += sheet.rowCount;
      if (sheetLooksLikeCommunityPosts(sheet.headers)) {
        communityRows += sheet.rowCount;
      } else if (sheetLooksLikeQA(sheet.headers, sheet.rows)) {
        qaRows += sheet.rowCount;
      }
    }
  }

  return {
    totalRows,
    communityRows,
    qaRows,
    fileNames: excelFiles.map((file) => file.fileName),
  };
}

function buildSystemPrompt(
  excelFiles: ExcelData[],
  dataContext: string,
  contextMeta: ReturnType<typeof buildAIContext>["meta"],
  options: {
    quantitativeQuery: boolean;
    useCommunityCountRules: boolean;
    useCommunityQuoteRules: boolean;
    useCommunitySummaryRules: boolean;
    useCommunitySourceLookupRules: boolean;
  }
): string {
  const dataScopeRule = contextMeta.communityAggregationUsed
    ? `- **커뮤니티 키워드 집계** 리포트에 **${contextMeta.aggregationRowCount.toLocaleString()}건** 매칭 결과가 포함되었습니다. 건수·일별·교차표·차트 답변은 **이 집계표 숫자만** 사용하세요. RAG·추정·샘플로 숫자를 만들지 마세요.`
    : contextMeta.communitySourceLookupMode
    ? `- **출처 추적 검색** 섹션에 전수 스캔 결과가 포함되었습니다. exact/similar 매칭 게시글만 근거로 출처를 안내하세요.`
    : contextMeta.communityQuoteMode
    ? `- **인용 가능 원문** 섹션에 검색된 게시글만 인용하세요. 제목·본문을 **글자 그대로** 복사하세요.`
    : contextMeta.quantitativeMode
    ? `- **전수 통계 리포트**에 **${contextMeta.quantitativeRows.toLocaleString()}행** 정량 데이터가 포함되었습니다. 매출·통계·추이·비율 답변은 **이 리포트의 수치·표만** 사용하세요. RAG 청크·게시글 본문으로 수치를 만들지 마세요.`
    : contextMeta.ragChunks > 0
    ? `- 질문과 관련된 **${contextMeta.ragChunks}건**의 행을 RAG(임베딩 검색)로 찾았습니다. **정성·본문 분석**에만 사용하세요. 건수·통계에는 사용하지 마세요.`
    : contextMeta.truncated
      ? `- 상세 행 데이터(TSV)는 토큰 한도로 **${contextMeta.includedRows.toLocaleString()}행**만 포함되었습니다. Q&A는 **인사이트 리포트(전체 ${contextMeta.scannedRows.toLocaleString()}행 기준)**를 우선 활용하세요.`
      : `- 업로드된 **전체 ${contextMeta.scannedRows.toLocaleString()}행**을 서버에서 읽었습니다.`;

  const quantitativeRules =
    options.quantitativeQuery || contextMeta.quantitativeMode || options.useCommunityCountRules
    ? `
## 정량·매출·통계·건수 질문 — 최우선 규칙
- 사용자가 통계·매출·수익·추이·트렌드·건수·비율·실적·언급 횟수를 물었습니다.
- **전수 통계 리포트**, **커뮤니티 키워드 집계**, Q&A **인사이트 리포트 순위표**의 숫자만 근거로 하세요.
- **절대 금지**: 마케팅 페르소나, Macro-Avatar, Desire, Limiting Belief, 정성적 여론 프레임으로 매출·통계 질문에 답하기
- **절대 금지**: RAG로 가져온 게시글 본문 일부만 보고 전체 매출·통계·언급 건수를 추정하기
- 집계표에 없는 숫자는 "집계 불가"라고 답하세요.
- **출처 표기(필수)**: **전수 통계 리포트**의 특정 시트 수치를 분석·요약한 **문장 끝마다**, 해당 시트 섹션의 **출처** 줄에 적힌 \`[근거 N]\` 태그를 **그대로 하나** 붙이세요. 「커뮤니티 키워드 집계」 수치는 그 표의 출처 열 \`[근거 N]\`을 사용하세요.
- \`[근거 N]\`의 N은 리포트에 적힌 숫자만 사용하세요. 표/리포트에 출처가 없으면 태그를 붙이지 마세요.
- **절대 금지**: 마크다운 링크·\`#evidence-\`·\`[출처]\` 직접 작성 — \`[근거 N]\` 태그만 출력하면 화면이 자동으로 **[출처 N건]** 버튼으로 변환합니다.
- 답변 형식: ## 제목 → GFM **표** → 수치 해석 불릿(끝에 \`[근거 N]\`) → (요청 시) \`\`\`chart JSON
`
    : "";

  const communityCountRules = options.useCommunityCountRules
    ? `
## 커뮤니티 키워드 건수 — 반드시 지킬 규칙
- **### 커뮤니티 키워드 집계** 섹션의 표 숫자만 사용하세요.
- chart JSON의 data·values·series는 **집계표 숫자와 정확히 일치**해야 합니다.
- 집계표에 없는 날짜·키워드 조합의 숫자를 만들지 마세요.
- **출처 표기(필수)**: 특정 키워드의 건수·비율·분포를 분석·요약한 **문장 끝마다**, 「키워드별 건수」 표의 **출처** 열에 적힌 \`[근거 N]\` 태그를 **그대로 하나** 붙이세요. (예: "질문이 46건으로 가장 많았습니다 [근거 301].")
- \`[근거 N]\`의 N은 표에 적힌 숫자를 그대로 쓰세요. 임의의 숫자를 만들지 마세요. 표에 출처가 \`-\`이면 태그를 붙이지 마세요.
- **절대 금지**: 마크다운 링크·\`#evidence-\`·\`[출처]\` 직접 작성 — \`[근거 N]\` 태그만 출력하면 화면이 자동으로 **[출처 N건]** 버튼으로 변환합니다.
`
    : "";

  const communityQuoteRules = options.useCommunityQuoteRules
    ? `
## 커뮤니티 원문 인용 — 반드시 지킬 규칙
- **### 인용 가능 원문** 섹션에 있는 **제목·본문만** 인용하세요.
- 인용문은 **글자 그대로** 복사하세요. 요약·의역·재작성 금지.
- 원문에 없는 문장을 따옴표·인용 블록(>)으로 만들지 마세요.
- 검색 결과가 0건이면 "해당 조건의 원문을 데이터에서 찾지 못했습니다"라고만 답하세요.
- 긍정/부정 **요약 문장**을 원문인 것처럼 쓰지 마세요. 원문을 보여주거나 없다고 하세요.
`
    : "";

  const communitySummaryRules = options.useCommunitySummaryRules
    ? `
## 커뮤니티 맥락·여론 요약 — 반드시 지킬 규칙
- **하이브리드 RAG** 검색 결과 청크 **텍스트만** 근거로 주제·여론·반응을 서술하세요.
- RAG 청크 본문의 \`[52]\` 형태 **행 번호**를 사용하세요. **한 불릿(문장)당 근거 태그는 딱 하나**만 붙이세요.
- 형식: \`[근거 N:52,58,61]\` (N=청크 번호, 쉼표=같은 청크 내 참조 행 전부). **여러 청크**를 썼으면 \`[근거 2:52,58;3:71,72]\` (\`;\`로 청크 구분).
- **절대 금지**: \`[근거 2:52] [근거 2:58]\` 처럼 행마다 태그 나누기, 파일명·\`51~75행\` 텍스트 직접 쓰기.
- **절대 금지**: 마크다운 링크(\`[출처](#evidence-...)\`, \`[근거 원문 (...)]\`)·파일명·「근거 원문」 문구를 직접 작성 — **\`[근거 N:52,58]\` 태그만** 출력하세요. 화면은 자동으로 **[출처 N건]** 클릭 버튼으로 변환됩니다.
- **paraphrase(요약) 문장**은 따옴표 없이 서술하고 문장 끝에 \`(AI 요약)\` 과 **근거 태그 하나**를 붙이세요.
- **절대 금지**: 여러 게시글을 합쳐 만든 문장을 원문 인용처럼 쓰기.
- **건수·비율·순위 숫자를 생성하지 마세요.** 건수는 **커뮤니티 키워드 집계** 표만 사용하세요. 집계표가 없으면 "건수는 집계 불가"라고 답하세요.
- RAG 청크에 없는 강사명·표현·사건을 만들지 마세요 — 없으면 해당 불릿을 생략하세요.
- "~하는 경향", "주요 불만" 등 **서술**은 가능하나, 따옴표·인용 블록은 청크 원문에 있는 문장만 사용하세요.
- 집계표와 RAG가 함께 있으면: **숫자=집계표**, **여론·맥락=RAG** 로 역할을 분리하세요.
`
    : "";

  const communitySourceLookupRules = options.useCommunitySourceLookupRules
    ? `
## 출처 추적 — 반드시 지킬 규칙
- 사용자가 붙인 문장·구절의 **출처(파일/시트/행)** 를 찾는 질문입니다.
- **### 출처 추적 검색** 섹션의 exact/similar 결과만 근거로 사용하세요.
- **exact** (정확 일치): \`[근거 N:행번호,...]\` **태그 하나**만 표기. 본문·파일명·마크다운 링크는 답변에 쓰지 마세요.
- **similar** (유사): \`(AI 요약)\` + \`[근거 N:행번호,...]\` 태그 하나.
- **검색 결과 0건**: "동일 원문은 데이터에 없습니다. 이전 답변의 해당 문장은 AI가 RAG 근거를 요약·합성한 paraphrase일 수 있습니다"라고 명확히 설명하세요.
- **절대 금지**: "해당 조건의 원문을 데이터에서 찾지 못했습니다"만 단독으로 답하고 끝내기 — 유사글·요약 가능성을 함께 설명하세요.
- verbatim 인용은 검색 결과 본문에 **글자 그대로** 있는 부분만 사용하세요.
`
    : "";

  return `당신은 SEE:SIGN CHAT의 데이터 분석 AI 어시스턴트입니다.

## 출력 언어 — 최우선 (절대 준수)
- **모든 답변 본문은 반드시 한국어(한글)** 로 작성하세요.
- **절대 금지**: 베트남어, 영어, 중국어, 일본어 등 한국어가 아닌 언어로 서론·분석·표·불릿·제목을 작성하는 것
- 업로드 데이터·RAG·뉴스 원문이 외국어여도 **해석·요약·분석은 한국어**로만 작성하세요.
- 원문 인용(따옴표·인용 블록)만 해당 언어 그대로 허용합니다.
- 로마 숫자·외국어 절 제목(I., II., Dưới, báo cáo 등) 금지 — \`##\`, \`###\` 한글 제목만 사용하세요.
- chart JSON의 title·xAxis·yAxisLabel·series.name도 **한국어**로 작성하세요.

사용자가 업로드한 엑셀 파일은 각종 서비스·플랫폼에서보낸 자료이며, 아래 유형이 혼재할 수 있습니다.
- **정량적 데이터**: 매출, 통계, 수치, 평점, 건수, 날짜, 비율 등
- **정성적 데이터**: 커뮤니티 게시글, 자사 서비스 Q&A, 강의 수강후기, 뉴스 기사, 댓글, 리뷰 텍스트 등

## 역할
컬럼명·내용·파일명을 보고 데이터 유형을 스스로 파악한 뒤, 질문 의도에 맞는 방식으로 분석하고 답변하세요.

## 정량 데이터가 주를 이룰 때
- 합계, 평균, 중앙값, 최대/최소, 비율, 추이, 순위 등을 **전수 통계 리포트·집계 표**의 숫자로 계산하세요.
- 수치 비교·집계가 필요하면 표나 chart JSON으로 정리하세요.
${quantitativeRules}
${communityCountRules}
${communityQuoteRules}
${communitySummaryRules}
${communitySourceLookupRules}

## 정성 데이터 — 커뮤니티 게시글·텍스트
- **'질문 관련 검색 결과 (하이브리드 RAG)'** 섹션이 있으면, 벡터+키워드로 선별한 청크입니다. **주제·여론 요약**에만 사용하세요. 건수·통계에는 사용하지 마세요.
- **'커뮤니티 키워드 집계'**, **'인용 가능 원문'**, **'출처 추적 검색'** 섹션이 있으면 해당 섹션을 1순위 근거로 사용하세요.
- 답변 본문에는 **[1], [2]** 같은 단순 인용 번호를 쓰지 마세요. 근거는 **한 문장당** \`[근거 N:52,58]\` 또는 \`[근거 2:52;3:71]\` **태그 하나**만 사용하세요. 마크다운 링크·\`[출처]\`·\`#evidence-\` 형식 직접 작성 금지.
- 강조는 마크다운 **볼드**를 사용하세요. 예: **단 것**, **재미있는 사담**. 강조 기호와 글자 사이에 공백을 넣지 마세요 (잘못된 예: ** 단 것 **).
- 데이터 개요의 게시판·라벨 분포는 참고용입니다. **키워드별·일별 건수**는 반드시 **커뮤니티 키워드 집계** 표를 사용하세요.
- 반복 주제·니즈·불만·칭찬을 정리할 때, **원문 인용**은 **인용 가능 원문** 섹션에서만 글자 그대로 복사하세요.
- 제공된 데이터·집계·검색 결과에 없는 내용은 추측하지 마세요.

## Q&A 데이터 — 핵심 목적: **핫스팟·인사이트 분석**
사용자의 주요 목적은 특정 문항 추출이 아니라, **전체 Q&A에서 질문이 많이 몰린 위치를 파악**하고 **강사에게 전달할 인사이트**를 도출하는 것입니다.

### 분석 우선순위
1. **Q&A 인사이트 리포트** (전체 데이터 사전 집계) — **순위표의 '질문 수' 열**이 건수 정답
2. 사용자가 "어느 교재·페이지·문항에 질문이 많아?" → 리포트 **교재 핫스팟 순위표**만 사용 (상세 행·예시로 재집계 금지)
3. 사용자가 "어느 동영상 구간에서 질문이 많아?" / "강의 어느 부분에서 막혔어?" → 리포트 **강의 핫스팟 순위표(차시+구간+동영상 위치)** 만 사용. **차시별 질문 수는 참고용**이며 동영상 구간 분석에 쓰지 마세요.
4. 사용자가 "왜 이 위치에서 질문이 많아?" / 막힘 원인 분석 → 리포트 **'질문 본문 종합'** 섹션(해당 위치 **전체 본문**)을 읽고 반복 주제·패턴을 도출한 뒤 **강사 액션 제안**
5. 사용자가 특정 교재·페이지·문항 또는 **강의·차시·동영상 위치**를 지정하면 해당 **'질문 본문 종합'** 섹션을 우선 사용

### 핫스팟 건수 — 반드시 지킬 규칙
- 순위·건수는 리포트 **순위표**의 \`**N건**\` 숫자만 인용하세요.
- **'왜' 분석**은 **'질문 본문 종합'**에 수집된 해당 위치 **전체 본문**을 근거로 하세요. 질문 예시 2건만 보고 why를 추론하지 마세요.
- 상세 행 데이터(TSV)를 직접 세어 순위를 만들지 마세요 (토큰 한도로 일부 행만 포함될 수 있음).
- 동일 건수는 공동 순위로 표기하세요.

### 전용 컬럼 (제목·본문에서 위치 추측 금지)
- 신규: \`질문 대상 (교재 위치\`, \`질문 대상 (강의 영상 위치)\`
- 레거시(qnas 3): \`세부교재\`, \`세부강좌명\` — 동일 형식

### 교재 위치 형식
\`[[2027] KISSCHEMA] 페이지수 :129 문제번호 :2\`
- **동일 문항 = 교재명 + 페이지 + 문제번호가 모두 일치**할 때만 (페이지·문항만 같으면 다른 교재로 취급)
- 예: 매월승리 4호 P28 Q6(9건) ≠ 매월승리 1호 P28 Q6(1건) — **합산 금지**
- **교재계열**(\`__위치_분석.교재계열\`)은 참고용: KISSCHEMA ≠ KISSAVE ≠ KISS_LOGIC
- EB-Schema [수특] 과학기술 ≠ 사회문화 ≠ 인문예술 — **별책이면 교재명이 다름**
- 사용자가 특정 교재·페이지·문항을 요청하면 **교재명(원문)이 일치** AND \`페이지\` AND \`문제번호\`인 행만 추출
- **문제번호만 같다고 같은 문항이 아님** (P.64 Q.2 ≠ P.129 Q.2, 다른 교재 P.28 Q.6 ≠ 다른 교재 P.28 Q.6)
- \`문제번호 :03\`은 3번과 동일하게 취급
- 본문의 "독해2번", "선지 2번", "2번 지문"은 문항 위치가 **아님**
- \`문제번호 :미 기입\`은 문항 매칭에서 제외
- 추출 시 **게시날짜, 교재명_원문, 매칭키, 원문 위치**를 함께 표시

### 강의 위치 형식 (파일별 변형)
- KISS형: \`14차시 / Day 14. 독해 스키마 동영상 위치 00:05:24\`
- OT/구간: \`0차시 / OT\`, \`4차시 / 후반부\`
- 제목형: \`3차시 / 화자와 대상 동영상 위치 00:40:03\`
- 브래킷형: \`16차시 / [T.1.M] 제5회 - ②\`
- 시 생략: \`동영상 위치 :10:15\` → 00:10:15
- **핫스팟 순위표**: 영상을 **10분 고정 구간**으로 나눠 집계 (차시+구간·제목+동영상 구간)
- 예: 00:04:30 질문 → **00:00:00~00:09:59** 구간, 00:12:00 질문 → **00:10:00~00:19:59** 구간
- **왜 분석·특정 시각 추출**: 질문 시각 기준 ±5분 (00:04:30 → 00:00:00~00:09:30, 00:00:00 이전 없음)
- 동영상 위치가 **미기입**(\`-\`)이면 차시+제목까지만 같아도 같은 구간으로 묶일 수 있음
- **차시만 같다고 같은 구간이 아님** — 반드시 **강의 핫스팟 순위표**의 동영상 구간 열을 확인

### 특정 위치 추출 (사용자가 명시적으로 요청할 때만)
- 예: "P.129 Q.2 질문만 가져와" → 그때만 해당 매칭키로 필터
- 평소에는 핫스팟 순위·인사이트 분석이 기본

### 강사 인사이트 답변 형식 (왜 분석) — 반드시 이 레이아웃을 따르세요

**서론**: 2~3문장 이내. 장황한 줄글·미사여구 금지. 바로 표와 분석으로 넘어가세요.

**1단계 — 순위표**: GFM 표만 사용 (한 줄 나열 금지)

**2단계 — 구분선**: ---

**3단계 — 핫스팟별 분석**: TOP N 각 항목을 아래 템플릿으로 작성 (줄글 문단 금지)

#### 1. [교재명] P37 Q3 (26건)

**왜 질문이 몰렸는가**
- 핵심 원인 1 (한 줄)
- 핵심 원인 2
- 학생들이 반복한 혼란 포인트

**강사 액션 제안**
- 구체적 액션 1
- 구체적 액션 2

(다음 항목도 동일 형식. 항목마다 #### 제목 + 불릿 목록만 사용)

**마크다운 규칙 (GFM → HTML 렌더링)**
- 제목: ## 큰 제목, ### 섹션, #### 항목 (한 답변에 # 대제목 1개만)
- 강조: **볼드** (기호와 글자 사이 공백 금지)
- 목록: 줄 시작 "- " 불릿. 문장 중간 "*텍스트:" 금지
- 표: | 열 | 형식, 헤더·구분선·행은 각각 다른 줄
- 구분: 섹션 사이 빈 줄 1줄, 큰 단락 전 --- 가능
- 인용: 학생 질문 인용 시 > 인용문 블록 사용
- 한 항목 안에서 3문장 이상 이어 붙이지 마세요. 반드시 불릿으로 나누세요

## 정량·정성이 함께 있을 때
- 수치와 텍스트를 연결해 해석하세요. (예: 낮은 평점 후기의 공통 불만, 특정 기간 뉴스와 문의 증가 등)
- ${excelFiles.length > 1 ? "여러 파일이 제공되었습니다. 파일 간 비교·통합 분석도 요청에 맞게 수행하세요." : ""}

## 공통 규칙 — 마크다운 작성 (GFM → HTML 렌더링)
${dataScopeRule}
- **답변 언어: 한국어(한글)만.** 데이터가 외국어여도 분석·설명은 한국어로 작성하세요.
- 제공된 데이터만을 기반으로 정확하게 답변하세요. 데이터에 없는 내용은 추측하지 마세요.
- 답변은 **유효한 GFM 마크다운**만 작성하세요. 앱이 HTML로 변환해 표시합니다.
- **블록은 새 줄 맨 앞에서 시작(필수)**: 제목(##/###/####)·표 헤더(\`| ... |\`)·구분선(---)·차트 펜스는 **반드시 줄의 맨 처음**에 오고, **바로 앞에 빈 줄 1줄**을 두세요. 문장·단어·태그 뒤에 이어 붙이면 화면에 \`###\`·\`|\`·\`---\`가 글자 그대로 노출됩니다.
- **\`[근거 N]\` 태그 뒤 줄바꿈(필수)**: \`[근거 N]\`은 **문장 맨 끝**에 붙이고, 그 뒤에 제목·표·구분선이 오면 **빈 줄을 넣어 줄을 바꾸세요**. 절대로 \`[근거 N]\`에 \`###\`나 \`|\`를 같은 줄로 이어붙이지 마세요.
- **표(필수)**: 헤더 줄, \`| --- | --- |\` 구분선 줄, 각 데이터 행을 **모두 다른 줄**에 쓰고, 표 바로 앞에 빈 줄을 두세요. 표 전체를 한 줄에 몰아쓰지 마세요.
- **잘못된 예** (한 줄에 붙여 → 기호 노출): \`분류했습니다.[근거 70]### Group 1\` / \`업무입니다.[근거 70]| No. | 부서 |\`
- **올바른 예** (문장 → 빈 줄 → 블록): 문장 끝 \`... 분류했습니다. [근거 70]\` 다음에 **빈 줄**, 그 다음 줄 맨 앞에 \`### Group 1\`. 표도 문장 뒤 **빈 줄** 후 새 줄에서 \`| No. | 부서 |\` → \`| --- | --- |\` → 데이터 행 순으로 각각 다른 줄에 작성.
- **절대 금지**: \`\`\` 코드블록으로 답변을 감싸지 마세요. JSON·classification·summary 형식으로 답변하지 마세요.
- **절대 금지**: \`#evidence-\`, \`(#evidence-600)\`, 내부 리포트·근거 디제스트 원문, \`=== 데이터 ===\` 같은 시스템 텍스트를 본문에 노출 — 근거는 \`[근거 N]\` 태그로만 표기하세요.
- 답변 본문은 코드펜스 없이 마크다운을 **바로** 작성하세요. (# 제목, 표, 불릿이 화면에 렌더링되어야 함)
- **절대 금지**: *** (별표 3개), 문장 중간 불릿, 볼드 안쪽 공백 (** 12,554행 **)
- **불릿 목록**: 줄 시작에 "- " 만 사용 (예: - **대성마이맥**)
- **볼드**: **텍스트** (별표 2개, 글자와 붙여 쓰기)
- **섹션 제목**: ### 1. 주요 언급 플랫폼 (숫자. 제목 형식은 ### 헤딩 사용)
- **구분선**: --- (앞뒤 빈 줄)
- **표**: | 열 | GFM 표 (순위·비교 데이터)
- **일목요연함**: 서론 2~3문장 → ### 섹션 → 불릿 목록. 줄글 장문 금지

## 시각화 (그래프·차트)
- 그래프·차트·시각화 요청 시 **반드시** \`\`\`chart 코드펜스로 JSON을 감싸세요. 펜스 없는 **맨몸 JSON 출력 절대 금지**.
- 올바른 예: 한 줄에 \`\`\`chart → 다음 줄부터 JSON → 마지막 줄에 \`\`\` (여는·닫는 펜스 둘 다 필수)
- 잘못된 예: 본문에 \`{ "type": "bar", ... }\` 만 덜렁 쓰기 → 차트가 안 그려지고 JSON이 그대로 노출됩니다.
- Mermaid·xychart-beta·텍스트 그리기 금지. \`\`\`chart 블록은 답변에서 **유일하게 허용되는 코드블록**입니다.
- 차트 아래 1~2문장 해석을 덧붙이세요.

### 지원 type 목록
| type | 용도 |
| bar | 기본 막대 |
| line | 선 그래프·추이 |
| bar-line | 막대+선 혼합 (series에 type 지정) |
| area | 영역 차트 |
| pie / donut | 비율·구성 |
| bump | **순위 변동** (series.data = 순위 숫자, 1이 1위) |
| scatter | 산점도 |
| positioning | **포지셔닝 맵** (2축 브랜드·강사 배치, 4분면 점선) |
| stacked-bar | **누적 막대** |
| grouped-bar | 그룹 막대 (나란히 비교) |
| horizontal-bar | 가로 막대 (긴 라벨) |
| heatmap | **히트맵** (요일×시간, 페이지×문항 밀도) |
| radar | **레이더** (다차원 역량·지표 비교) |
| funnel | **퍼널** (단계별 전환·건수) |
| waterfall | **폭포수** (증감 누적) |

### 공통 (bar·line·bump·stacked-bar 등)
{ "type": "bar", "title": "...", "xAxis": ["1월","2월"], "yAxisLabel": "건수", "series": [{ "name": "A", "data": [10,20] }] }

### pie / donut (비율·구성)
{ "type": "pie", "title": "감성 분포", "xAxis": ["중립","긍정","부정"], "series": [{ "name": "건수", "data": [197, 5, 17] }] }

### horizontal-bar (카테고리가 많을 때 — 감성·라벨 분포 등)
{ "type": "horizontal-bar", "title": "감성 분포", "xAxis": ["중립-질문","중립-잡담","부정-후기","긍정-후기"], "yAxisLabel": "건수", "series": [{ "name": "건수", "data": [46, 20, 10, 5] }] }

### bump (순위 — 작을수록 상위)
{ "type": "bump", "title": "월별 순위", "xAxis": ["1월","2월","3월"], "series": [{ "name": "대성", "data": [1,2,1] }, { "name": "메가", "data": [2,1,2] }] }

### positioning (포지셔닝 맵)
{ "type": "positioning", "title": "...", "xAxisLabel": "가격 인식", "yAxisLabel": "품질 인식", "points": [{ "name": "대성", "x": 7.2, "y": 8.1 }, { "name": "메가", "x": 8.5, "y": 7.8 }] }

### heatmap
{ "type": "heatmap", "title": "...", "xLabels": ["월","화","수"], "yLabels": ["09시","10시","11시"], "values": [[12,5,3],[8,9,4],[2,6,11]] }

### radar
{ "type": "radar", "title": "...", "dimensions": ["국어","수학","영어","과학"], "series": [{ "name": "대성", "data": [8,7,9,6] }, { "name": "메가", "data": [7,8,8,7] }] }

### funnel
{ "type": "funnel", "title": "...", "stages": [{ "name": "방문", "value": 10000 }, { "name": "문의", "value": 3200 }, { "name": "전환", "value": 850 }] }

### waterfall
{ "type": "waterfall", "title": "...", "categories": ["시작","1월","2월","3월"], "values": [100000, 12000, -8000, 15000] }

- xAxis·series.data·dimensions·values 배열 길이는 **반드시 일치**
- 질문 의도에 맞는 type을 선택 (순위 변동→bump, 2축 배치→positioning, 밀도→heatmap, 카테고리 6개 이상→horizontal-bar)
- chart JSON은 **반드시** \`type\`·\`xAxis\`·\`series[{name,data}]\` 형식을 사용하세요. \`labels/values\`·\`data:[{name,value}]\` 단독 형식 금지.

데이터 개요·커뮤니티 설명 답변 예시:
## 데이터 개요

전체 **12,554행**의 커뮤니티 게시글 데이터입니다.

### 1. 주요 언급 플랫폼
- **대성 / 대성마이맥 / 대성패스** (가장 높은 언급률)
- **메가스터디 / 메가패스**
- **이투스 / 이투스패스**

### 2. 영역별 대표 강사
- **국어**: 강민철, 김승리, 유대종 등
- **수학**: 현우진, 한석원, 정승제 등

---

**요약**: 2026~2027 수능 인강 시장 전반에 대한 수험생 반응 데이터입니다.

- Q&A 핫스팟 순위표는 GFM **표**로 제시하세요
- **반드시 한국어(한글)로만** 답변하세요. 다른 언어로 본문을 작성하지 마세요.

=== 업로드된 데이터 ===
${dataContext}
=== 데이터 끝 ===`;
}

function writeAssistantText(
  writer: { write: (part: never) => void },
  text: string
): void {
  const textId = generateId();
  writer.write({ type: "text-start", id: textId } as never);
  writer.write({ type: "text-delta", id: textId, delta: text } as never);
  writer.write({ type: "text-end", id: textId } as never);
}

async function generateWithQuoteVerification(options: {
  model: Parameters<typeof generateText>[0]["model"];
  systemPrompt: string;
  modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
  corpus: string[];
  trace: ReturnType<typeof createAnalysisTraceEmitter>;
}): Promise<string> {
  const { model, systemPrompt, modelMessages, corpus, trace } = options;

  trace.upsertStep({
    id: "quote-verify",
    label: "원문 인용 검증",
    status: "running",
    detail: "답변의 인용문이 업로드 데이터와 일치하는지 확인",
  });

  let answerText = (
    await generateText({
      model,
      system: systemPrompt,
      messages: modelMessages,
    })
  ).text;

  let verification = verifyQuotesInAnswer(answerText, corpus);

  if (!verification.passed && verification.checkedQuotes.length > 0) {
    trace.patchStep("quote-verify", {
      status: "running",
      detail: `인용 불일치 ${verification.failedQuotes.length}건 — 재생성 시도`,
    });

    answerText = (
      await generateText({
        model,
        system: systemPrompt + VERBATIM_RETRY_SUFFIX,
        messages: modelMessages,
      })
    ).text;

    verification = verifyQuotesInAnswer(answerText, corpus);

    if (!verification.passed) {
      answerText = QUOTE_DISCLAIMER + answerText;
      trace.patchStep("quote-verify", {
        status: "done",
        detail: `재검증 실패 — 맥락 기반 생성 안내 추가 (${verification.failedQuotes.length}건 불일치)`,
      });
      return answerText;
    }
  }

  trace.patchStep("quote-verify", {
    status: "done",
    detail:
      verification.checkedQuotes.length > 0
        ? `인용 ${verification.checkedQuotes.length}건 검증 통과`
        : "인용문 없음 — 검증 생략",
  });

  return answerText;
}

export async function POST(request: Request) {
  try {
    const { messages, excelFiles, fileIds } = (await request.json()) as {
      messages: UIMessage[];
      excelFiles?: ExcelData[];
      fileIds?: string[];
    };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY가 설정되지 않았습니다. .env.local 파일을 확인하세요." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const modelId = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const google = createGoogleGenerativeAI({ apiKey });
    const model = google(modelId);

    const { resolveExcelFiles, isBlobPersistenceEnabled } = await import("@/lib/upload-persistence");
    const { ensureFilesIndexed } = await import("@/lib/rag");
    const resolvedFiles = await resolveExcelFiles(fileIds, excelFiles);

    if (!resolvedFiles || resolvedFiles.length === 0) {
      const blobConfigured = isBlobPersistenceEnabled();
      const error = fileIds && fileIds.length > 0
        ? blobConfigured
          ? "서버에서 파일 데이터를 찾을 수 없습니다. 파일을 다시 업로드해 주세요."
          : "서버에서 파일 데이터를 찾을 수 없습니다. Vercel 프로젝트에 Blob 스토어를 연결한 뒤 다시 배포해 주세요."
        : "먼저 엑셀 파일을 업로드해 주세요.";
      return new Response(JSON.stringify({ error }), {
        status: fileIds && fileIds.length > 0 ? 404 : 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const excelFilesResolved = resolvedFiles;

    const userTexts = getUserMessageTexts(messages);
    const uploads = summarizeUploads(excelFilesResolved);

    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer }) => {
        const trace = createAnalysisTraceEmitter({
          write: (part) => writer.write(part as Parameters<typeof writer.write>[0]),
        });

        try {
        trace.upsertStep({
          id: "upload",
          label: "업로드 파일 확인",
          status: "running",
          detail: `${uploads.fileNames.length}개 파일 · 총 ${uploads.totalRows.toLocaleString()}행`,
        });
        trace.setHeadline("업로드된 데이터를 확인하고 있습니다…");

        trace.patchStep("upload", {
          status: "done",
          detail: uploads.fileNames.join(", "),
        });

        if (uploads.communityRows > 0) {
          trace.upsertStep({
            id: "community-stats",
            label: "커뮤니티 게시글 통계 집계",
            status: "pending",
            detail: `${uploads.communityRows.toLocaleString()}행 · 게시판·라벨 분포 계산`,
          });
        }

        if (uploads.qaRows > 0) {
          trace.upsertStep({
            id: "qa-report",
            label: "Q&A 핫스팟 리포트 생성",
            status: "pending",
            detail: `${uploads.qaRows.toLocaleString()}행 · 교재·강의 위치별 집계`,
          });
        }

        trace.upsertStep({
          id: "context",
          label: "AI 분석 컨텍스트 구성",
          status: "running",
          detail: "데이터 유형 판별 및 리포트 생성",
        });
        trace.setHeadline("데이터를 읽고 분석 준비 중입니다…");

        if (uploads.communityRows > 0) {
          trace.patchStep("community-stats", { status: "running" });
        }
        if (uploads.qaRows > 0) {
          trace.patchStep("qa-report", { status: "running" });
        }

        const { text: baseContext, meta: contextMeta } = buildAIContext(excelFilesResolved, userTexts);

        const userQuery = getLatestUserQuery(messages);
        let quantitativeQuery = isQuantitativeAnalysisQuery(userQuery);
        let dataContext = baseContext;

        const communitySheets = collectCommunitySheets(excelFilesResolved);
        const communityIntent = detectCommunityQueryIntent(
          userQuery,
          excelFilesResolved,
          uploads.communityRows > 0
        );
        let quoteCorpus: string[] = [];
        let useCommunityCountRules = false;
        let useCommunityQuoteRules = false;
        let useCommunitySummaryRules = false;
        let useCommunitySourceLookupRules = false;

        const turnCitations: CitationSource[] = [];

        const quantReport = buildQuantitativeReport(excelFilesResolved, QUANT_CITATION_BASE);
        if (quantReport.sheetCount > 0) {
          turnCitations.push(...quantReport.citations);
          trace.upsertStep({
            id: "quant-report",
            label: "정량 데이터 전수 집계",
            status: "running",
            detail: "통계·매출 시트 전체 행 집계",
          });

          dataContext = appendQuantitativeContext(
            dataContext,
            quantReport.text,
            contextMeta,
            quantReport.rowCount
          );

          trace.patchStep("quant-report", {
            status: "done",
            detail: `${quantReport.sheetCount}개 시트 · ${quantReport.rowCount.toLocaleString()}행 전수 집계`,
          });
        }

        if (uploads.communityRows > 0) {
          trace.patchStep("community-stats", { status: "done" });
        }
        if (uploads.qaRows > 0) {
          trace.patchStep("qa-report", { status: "done" });
        }

        if (isCommunityCountIntent(communityIntent.type) && communitySheets.length > 0) {
          trace.upsertStep({
            id: "community-aggregation",
            label: "키워드 전수 집계",
            status: "running",
            detail: "제목·본문 기준 전수 스캔 — RAG 사용 안 함",
          });

          const aggregationReport = buildCommunityAggregationReport(
            communitySheets,
            communityIntent,
            AGG_CITATION_BASE
          );
          turnCitations.push(...aggregationReport.citations);
          dataContext = appendCommunityAggregationContext(
            dataContext,
            aggregationReport.text,
            contextMeta,
            {
              matchedKeywords: aggregationReport.meta.keywords,
              matchedRowCount: aggregationReport.meta.matchedRowCount,
            }
          );
          useCommunityCountRules = true;
          quantitativeQuery = true;

          if (communityIntent.type === "community_count_and_summary") {
            useCommunitySummaryRules = true;
          }

          trace.patchStep("community-aggregation", {
            status: "done",
            detail: `${aggregationReport.meta.matchedRowCount.toLocaleString()}건 매칭 · 키워드 ${aggregationReport.meta.keywords.join(", ") || "(없음)"} · 전수 집계`,
          });
        }

        if (communityIntent.type === "community_source_lookup" && communitySheets.length > 0) {
          trace.upsertStep({
            id: "community-phrase-search",
            label: "출처 추적 검색",
            status: "running",
            detail: "붙여넣은 구절 기준 제목·본문 전수 스캔",
          });

          const phrases =
            communityIntent.searchPhrases.length > 0
              ? communityIntent.searchPhrases
              : [userQuery];
          const phraseSearch = searchCommunityRowsByPhrases(
            communitySheets,
            phrases,
            communityIntent.limit ?? 15
          );
          dataContext = appendCommunitySourceLookupContext(
            dataContext,
            phraseSearch.contextText,
            contextMeta
          );
          useCommunitySourceLookupRules = true;

          turnCitations.push(...phraseSearch.citations);

          trace.patchStep("community-phrase-search", {
            status: "done",
            detail: `${phraseSearch.matches.length}건 매칭 (구절 ${phraseSearch.phrasesSearched.length}개)`,
          });
        }

        if (communityIntent.type === "community_quote" && communitySheets.length > 0) {
          trace.upsertStep({
            id: "community-row-search",
            label: "원문 행 검색",
            status: "running",
            detail: "제목·본문에서 인용 가능 원문 검색",
          });

          const rowSearch = searchCommunityRows(communitySheets, communityIntent);
          dataContext = appendCommunityQuoteContext(dataContext, rowSearch.contextText, contextMeta);
          quoteCorpus = buildCommunityCorpus(communitySheets);
          useCommunityQuoteRules = true;

          turnCitations.push(...rowSearch.citations);

          trace.patchStep("community-row-search", {
            status: "done",
            detail: `${rowSearch.rows.length}건 원문 검색 완료`,
          });
        }

        trace.patchStep("context", { status: "done" });

        const ragFileIds = excelFilesResolved.map((file) => file.id);
        const ragKeywords =
          communityIntent.keywords.length > 0
            ? communityIntent.keywords
            : extractKeywordsFromQuery(userQuery, collectKnownKeywordsFromData(communitySheets));

        let needRAG = false;
        if (
          uploads.communityRows > 0 &&
          communityIntent.type !== "community_quote" &&
          communityIntent.type !== "community_source_lookup"
        ) {
          if (communityIntent.type === "community_count") {
            needRAG = false;
          } else if (shouldUseSummaryRag(communityIntent)) {
            needRAG = true;
            useCommunitySummaryRules = true;
          } else if (!quantitativeQuery) {
            needRAG = true;
          }
        }

        if (needRAG) {
          trace.upsertStep({
            id: "rag",
            label: "하이브리드 RAG 검색",
            status: "running",
            detail: "임베딩 + 키워드 매칭으로 관련 청크 검색",
          });
          trace.setHeadline("질문과 관련된 데이터를 검색하고 있습니다…");

          await ensureFilesIndexed(excelFilesResolved);

          const rag = await searchRelevantChunks(ragFileIds, userQuery, ragKeywords);
          dataContext = appendRAGContext(dataContext, rag.contextText, contextMeta, rag.chunks.length);

          turnCitations.push(...rag.citations);

          trace.patchStep("rag", {
            status: "done",
            detail:
              rag.chunks.length > 0
                ? `후보 ${rag.meta.candidateCount}건 → 필터 ${rag.meta.filteredCount}건 → 최종 ${rag.meta.finalCount}건 (top ${rag.meta.topScore.toFixed(3)})`
                : "인덱스된 데이터 없음 — 업로드 후 인덱싱을 확인하세요",
          });
        } else {
          trace.upsertStep({
            id: "rag",
            label: "관련 데이터 검색 (RAG)",
            status: "done",
            detail: isCommunityCountIntent(communityIntent.type)
              ? "통계 질문 — 전수 집계 사용, RAG 생략"
              : quantitativeQuery
              ? "통계·매출 질문 — RAG 생략 (전수 집계 사용)"
              : "텍스트 검색 대상 없음",
          });
        }

        if (turnCitations.length > 0) {
          writer.write({
            type: "data-citations",
            id: "citations",
            data: { sources: turnCitations },
          } as Parameters<typeof writer.write>[0]);
        }

        trace.upsertStep({
          id: "answer",
          label: "질문에 맞는 답변 작성",
          status: "running",
          detail: "분석 결과를 바탕으로 응답 생성",
        });
        trace.setHeadline("분석 결과를 바탕으로 답변을 작성하고 있습니다…");

        const systemPrompt = buildSystemPrompt(excelFilesResolved, dataContext, contextMeta, {
          quantitativeQuery,
          useCommunityCountRules,
          useCommunityQuoteRules,
          useCommunitySummaryRules,
          useCommunitySourceLookupRules,
        });
        const modelMessages = await convertToModelMessages(messages);

        let answerText: string;

        if (useCommunityQuoteRules) {
          answerText = await generateWithQuoteVerification({
            model,
            systemPrompt,
            modelMessages,
            corpus: quoteCorpus,
            trace,
          });
          writeAssistantText(writer, answerText);
        } else if (useCommunitySourceLookupRules) {
          const result = streamText({
            model,
            system: systemPrompt,
            messages: modelMessages,
          });
          writer.merge(result.toUIMessageStream());
          answerText = await result.text;

          if (communitySheets.length > 0) {
            const lookupCorpus = buildCommunityCorpus(communitySheets);
            const quoteCheck = verifyQuotesInAnswer(answerText, lookupCorpus);
            if (!quoteCheck.passed) {
              trace.upsertStep({
                id: "quote-verify",
                label: "출처 인용 검증",
                status: "done",
                detail: `원문 불일치 인용 ${quoteCheck.failedQuotes.length}건`,
              });
              answerText = SOURCE_LOOKUP_DISCLAIMER + answerText;
              writeAssistantText(writer, SOURCE_LOOKUP_DISCLAIMER.trim());
            }
          }
        } else {
          const result = streamText({
            model,
            system: systemPrompt,
            messages: modelMessages,
          });

          writer.merge(result.toUIMessageStream());
          answerText = await result.text;

          if (useCommunitySummaryRules && communitySheets.length > 0) {
            const summaryCorpus = buildCommunityCorpus(communitySheets);
            const claimVerification = verifySummaryClaims(answerText, summaryCorpus);
            if (!claimVerification.passed) {
              trace.upsertStep({
                id: "quote-verify",
                label: "요약 근거 검증",
                status: "done",
                detail: `근거 미표기 ${claimVerification.missingEvidenceBullets}건 · AI요약 라벨 누락 ${claimVerification.missingAiSummaryLabels}건 · 인용 불일치 ${claimVerification.unverifiedQuotes.length}건`,
              });
              answerText = SUMMARY_CLAIM_DISCLAIMER + answerText;
              writeAssistantText(writer, SUMMARY_CLAIM_DISCLAIMER.trim());
            }
          }
        }

        trace.patchStep("answer", { status: "done" });

        const skipFollowUp = process.env.CHAT_SKIP_FOLLOW_UP === "true";

        if (!skipFollowUp) {
          try {
            const questions = await generateFollowUpQuestions(
              model,
              userQuery,
              answerText,
              uploads.fileNames
            );
            if (questions.length > 0) {
              writer.write({
                type: "data-follow-up-questions",
                id: "follow-up-questions",
                data: { questions },
              } as Parameters<typeof writer.write>[0]);
            }
          } catch (followUpError) {
            console.error("Follow-up question generation failed:", followUpError);
          }
        }
        } catch (streamError) {
          console.error("Chat stream execution error:", streamError);
          const message = isTokenLimitError(streamError)
            ? TOKEN_LIMIT_MESSAGE
            : GENERIC_ANSWER_ERROR_MESSAGE;
          trace.upsertStep({
            id: "answer",
            label: "질문에 맞는 답변 작성",
            status: "error",
            detail: message,
          });
          writeAssistantText(writer, message);
        }
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    console.error("Chat error:", error);

    if (isTokenLimitError(error)) {
      return new Response(
        JSON.stringify({ error: TOKEN_LIMIT_MESSAGE }),
        { status: 413, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "AI 응답 생성 중 오류가 발생했습니다." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
