import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { APICallError } from "ai";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  UIMessage,
} from "ai";
import { createAnalysisTraceEmitter } from "@/lib/analysis-trace";
import { appendRAGContext, buildAIContext } from "@/lib/excel";
import { generateFollowUpQuestions } from "@/lib/follow-up-questions";
import { searchRelevantChunks } from "@/lib/rag";
import { sheetLooksLikeCommunityPosts } from "@/lib/community-analysis";
import { sheetLooksLikeQA } from "@/lib/qa-location";
import type { ExcelData } from "@/lib/types";

export const maxDuration = 300;

const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

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
  contextMeta: ReturnType<typeof buildAIContext>["meta"]
): string {
  const dataScopeRule = contextMeta.ragChunks > 0
    ? `- 질문과 관련된 **${contextMeta.ragChunks}건**의 행을 RAG(임베딩 검색)로 찾았습니다. **'질문 관련 검색 결과 (RAG)'** 섹션을 우선 근거로 하세요.`
    : contextMeta.truncated
      ? `- 상세 행 JSON은 토큰 한도로 **${contextMeta.includedRows.toLocaleString()}행**만 포함되었습니다. Q&A는 **인사이트 리포트(전체 ${contextMeta.scannedRows.toLocaleString()}행 기준)**를 우선 활용하세요.`
      : `- 업로드된 **전체 ${contextMeta.scannedRows.toLocaleString()}행**을 서버에서 읽었습니다.`;

  return `당신은 SEE:SIGN CHAT의 데이터 분석 AI 어시스턴트입니다.

사용자가 업로드한 엑셀 파일은 각종 서비스·플랫폼에서보낸 자료이며, 아래 유형이 혼재할 수 있습니다.
- **정량적 데이터**: 매출, 통계, 수치, 평점, 건수, 날짜, 비율 등
- **정성적 데이터**: 커뮤니티 게시글, 자사 서비스 Q&A, 강의 수강후기, 뉴스 기사, 댓글, 리뷰 텍스트 등

## 역할
컬럼명·내용·파일명을 보고 데이터 유형을 스스로 파악한 뒤, 질문 의도에 맞는 방식으로 분석하고 답변하세요.

## 정량 데이터가 주를 이룰 때
- 합계, 평균, 중앙값, 최대/최소, 비율, 추이, 순위 등을 데이터 기반으로 계산하세요.
- 수치 비교·집계가 필요하면 표나 목록으로 정리하세요.

## 정성 데이터 — 커뮤니티 게시글·텍스트
- **'질문 관련 검색 결과 (RAG)'** 섹션이 있으면, 질문과 의미적으로 가까운 행입니다. 이를 1순위 근거로 사용하세요.
- 답변 본문에는 **[1], [2]** 같은 인용 번호를 **표기하지 마세요**. 출처는 화면 하단 목록으로 자동 표시됩니다.
- 강조는 마크다운 **볼드**를 사용하세요. 예: **단 것**, **재미있는 사담**. 강조 기호와 글자 사이에 공백을 넣지 마세요 (잘못된 예: ** 단 것 **).
- 데이터 개요의 게시판·라벨·키워드 컬럼 통계는 건수 근거로 활용하세요.
- 반복 주제, 니즈, 불만·칭찬, 제품·혜택 언급을 정리하고, 필요 시 짧게 인용하세요.
- RAG 검색 결과에 없는 내용은 추측하지 마세요.

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
- 상세 행 JSON을 직접 세어 순위를 만들지 마세요 (토큰 한도로 일부 행만 포함될 수 있음).
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
- 제공된 데이터만을 기반으로 정확하게 답변하세요. 데이터에 없는 내용은 추측하지 마세요.
- 답변은 **유효한 GFM 마크다운**만 작성하세요. 앱이 HTML로 변환해 표시합니다.
- **절대 금지**: \`\`\` 코드블록으로 답변을 감싸지 마세요. JSON·classification·summary 형식으로 답변하지 마세요.
- 답변 본문은 코드펜스 없이 마크다운을 **바로** 작성하세요. (# 제목, 표, 불릿이 화면에 렌더링되어야 함)
- **절대 금지**: *** (별표 3개), 문장 중간 불릿, 볼드 안쪽 공백 (** 12,554행 **)
- **불릿 목록**: 줄 시작에 "- " 만 사용 (예: - **대성마이맥**)
- **볼드**: **텍스트** (별표 2개, 글자와 붙여 쓰기)
- **섹션 제목**: ### 1. 주요 언급 플랫폼 (숫자. 제목 형식은 ### 헤딩 사용)
- **구분선**: --- (앞뒤 빈 줄)
- **표**: | 열 | GFM 표 (순위·비교 데이터)
- **일목요연함**: 서론 2~3문장 → ### 섹션 → 불릿 목록. 줄글 장문 금지

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
- 한국어로 답변하세요.

=== 업로드된 데이터 ===
${dataContext}
=== 데이터 끝 ===`;
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

    const { getExcelFilesByIds } = await import("@/lib/upload-data-store");
    const resolvedFiles =
      fileIds && fileIds.length > 0
        ? getExcelFilesByIds(fileIds)
        : excelFiles && excelFiles.length > 0
          ? excelFiles
          : undefined;

    if (!resolvedFiles || resolvedFiles.length === 0) {
      const error =
        fileIds && fileIds.length > 0
          ? "서버에서 파일 데이터를 찾을 수 없습니다. Vercel 재시작 후에는 파일을 다시 업로드해 주세요."
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

        if (uploads.communityRows > 0) {
          trace.patchStep("community-stats", { status: "done" });
        }
        if (uploads.qaRows > 0) {
          trace.patchStep("qa-report", { status: "done" });
        }
        trace.patchStep("context", { status: "done" });

        let dataContext = baseContext;
        const userQuery = getLatestUserQuery(messages);
        const ragFileIds = excelFilesResolved.map((file) => file.id);

        trace.upsertStep({
          id: "rag",
          label: "관련 데이터 검색 (RAG)",
          status: "running",
          detail: "질문을 임베딩해 관련 행을 찾는 중…",
        });
        trace.setHeadline("질문과 관련된 데이터를 검색하고 있습니다…");

        const rag = await searchRelevantChunks(ragFileIds, userQuery);
        dataContext = appendRAGContext(baseContext, rag.contextText, contextMeta, rag.chunks.length);

        if (rag.citations.length > 0) {
          writer.write({
            type: "data-citations",
            id: "citations",
            data: { sources: rag.citations },
          } as Parameters<typeof writer.write>[0]);
        }

        trace.patchStep("rag", {
          status: "done",
          detail:
            rag.chunks.length > 0
              ? `${rag.chunks.length}건 관련 행 검색 완료`
              : "인덱스된 데이터 없음 — 업로드 후 인덱싱을 확인하세요",
        });

        trace.upsertStep({
          id: "answer",
          label: "질문에 맞는 답변 작성",
          status: "running",
          detail: "분석 결과를 바탕으로 응답 생성",
        });
        trace.setHeadline("분석 결과를 바탕으로 답변을 작성하고 있습니다…");

        const systemPrompt = buildSystemPrompt(excelFilesResolved, dataContext, contextMeta);
        const result = streamText({
          model,
          system: systemPrompt,
          messages: await convertToModelMessages(messages),
        });

        writer.merge(result.toUIMessageStream());
        const answerText = await result.text;
        trace.patchStep("answer", { status: "done" });

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
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    console.error("Chat error:", error);

    const isTokenLimit =
      APICallError.isInstance(error) &&
      (error.message.includes("token count exceeds") ||
        error.message.includes("maximum number of tokens"));

    if (isTokenLimit) {
      return new Response(
        JSON.stringify({
          error:
            "데이터가 너무 커서 AI 입력 한도를 초과했습니다. 파일 수를 줄이거나, .env에 GEMINI_MAX_CONTEXT_CHARS=500000 처럼 더 낮게 설정해 주세요.",
        }),
        { status: 413, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "AI 응답 생성 중 오류가 발생했습니다." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
