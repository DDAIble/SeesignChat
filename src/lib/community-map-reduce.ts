import { generateText, type LanguageModel } from "ai";
import {
  chunkRows,
  formatRowForBatch,
  type CommunitySheetData,
} from "./community-analysis";

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MERGE_GROUP_SIZE = 12;

export interface CommunityMapReduceProgress {
  phase: "batch" | "merge";
  completed: number;
  inFlight: number;
  concurrency: number;
  total: number;
  rowsProcessed: number;
  totalRows: number;
}

export function getCommunityMapReduceConfig() {
  return {
    batchSize: getBatchSize(),
    concurrency: getConcurrency(),
    mergeGroupSize: getMergeGroupSize(),
  };
}

function getBatchSize(): number {
  const env = process.env.COMMUNITY_MAP_BATCH_SIZE;
  if (!env) return DEFAULT_BATCH_SIZE;
  const parsed = Number(env);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_SIZE;
}

function getConcurrency(): number {
  const env = process.env.COMMUNITY_MAP_CONCURRENCY;
  if (!env) return DEFAULT_CONCURRENCY;
  const parsed = Number(env);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CONCURRENCY;
}

function getMergeGroupSize(): number {
  const env = process.env.COMMUNITY_MAP_MERGE_GROUP_SIZE;
  if (!env) return DEFAULT_MERGE_GROUP_SIZE;
  const parsed = Number(env);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MERGE_GROUP_SIZE;
}

interface ConcurrencyProgress {
  index: number;
  inFlight: number;
  completed: number;
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
  callbacks?: {
    onTaskStart?: (progress: ConcurrencyProgress) => void;
    onTaskDone?: (progress: ConcurrencyProgress) => void;
  }
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  let inFlight = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      inFlight += 1;
      callbacks?.onTaskStart?.({ index, inFlight, completed });
      try {
        results[index] = await tasks[index]();
      } finally {
        inFlight -= 1;
        completed += 1;
        callbacks?.onTaskDone?.({ index, inFlight, completed });
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

const BATCH_SYSTEM = `당신은 커뮤니티 게시글 배치 분석기입니다.
주어진 게시글 묶음에서 사실에 기반해 다음을 간결히 정리하세요:
- 반복 주제·키워드
- 요청·니즈·불만·칭찬
- 언급된 상품·서비스·혜택·이벤트
- 감성 경향(가능할 때)

사용자 질문에 직접 관련 없어 보이는 내용도 빠뜨리지 마세요. 데이터에 없는 내용은 추측하지 마세요.`;

const MERGE_SYSTEM = `당신은 여러 배치 요약을 통합하는 분석기입니다.
아래 배치 요약들은 **서로 다른 게시글 묶음**에서 나온 것이며, 합치면 전체 데이터셋을 커버합니다.
중복은 줄이고, 전체적으로 드러나는 패턴·건수 감각·대표 니즈를 정리하세요. 추측은 하지 마세요.`;

async function summarizeBatch(
  model: LanguageModel,
  batch: Record<string, unknown>[],
  batchIndex: number,
  totalBatches: number,
  startRowIndex: number,
  userQuery: string
): Promise<string> {
  const lines = batch.map((row, i) => formatRowForBatch(row, startRowIndex + i + 1));
  const { text } = await generateText({
    model,
    system: BATCH_SYSTEM,
    prompt: `사용자 질문: ${userQuery}

배치 ${batchIndex + 1}/${totalBatches} — 게시글 ${batch.length}건 (전체 데이터 중 ${startRowIndex + 1}~${startRowIndex + batch.length}번째 행)

${lines.join("\n")}`,
    maxOutputTokens: 2000,
  });
  return text.trim();
}

async function mergeSummaryGroup(
  model: LanguageModel,
  summaries: string[],
  groupIndex: number,
  totalGroups: number,
  userQuery: string
): Promise<string> {
  const { text } = await generateText({
    model,
    system: MERGE_SYSTEM,
    prompt: `사용자 질문: ${userQuery}

통합 그룹 ${groupIndex + 1}/${totalGroups}

${summaries.map((s, i) => `--- 배치 요약 ${i + 1} ---\n${s}`).join("\n\n")}`,
    maxOutputTokens: 3000,
  });
  return text.trim();
}

async function hierarchicalMerge(
  model: LanguageModel,
  summaries: string[],
  userQuery: string,
  onProgress?: (completed: number, total: number, inFlight: number) => void
): Promise<string[]> {
  let current = summaries;
  let level = 0;

  const concurrency = getConcurrency();

  while (current.length > getMergeGroupSize()) {
    level += 1;
    const groups = chunkRows(current, getMergeGroupSize());
    const tasks = groups.map(
      (group, i) => () => mergeSummaryGroup(model, group, i, groups.length, userQuery)
    );
    current = await runWithConcurrency(tasks, concurrency, {
      onTaskStart: ({ inFlight, completed }) => {
        onProgress?.(completed, groups.length, inFlight);
      },
      onTaskDone: ({ completed, inFlight }) => {
        onProgress?.(completed, groups.length, inFlight);
      },
    });
    if (level > 5) break;
  }

  return current;
}

export interface CommunityMapReduceResult {
  text: string;
  rowsProcessed: number;
  batchesProcessed: number;
}

export async function buildCommunityMapReduceContext(
  model: LanguageModel,
  sheets: CommunitySheetData[],
  userQuery: string,
  onProgress?: (progress: CommunityMapReduceProgress) => void
): Promise<CommunityMapReduceResult | null> {
  const allRows = sheets.flatMap((sheet) => sheet.rows);
  if (allRows.length === 0) return null;

  const query = userQuery.trim() || "업로드된 게시글 전체를 분석해 주세요.";
  const { batchSize, concurrency } = getCommunityMapReduceConfig();
  const batches = chunkRows(allRows, batchSize);

  const reportBatchProgress = (completed: number, inFlight: number) => {
    onProgress?.({
      phase: "batch",
      completed,
      inFlight,
      concurrency,
      total: batches.length,
      rowsProcessed: Math.min(completed * batchSize, allRows.length),
      totalRows: allRows.length,
    });
  };

  reportBatchProgress(0, 0);

  const batchTasks = batches.map(
    (batch, i) => () => summarizeBatch(model, batch, i, batches.length, i * batchSize, query)
  );

  const batchSummaries = await runWithConcurrency(batchTasks, concurrency, {
    onTaskStart: ({ completed, inFlight }) => reportBatchProgress(completed, inFlight),
    onTaskDone: ({ completed, inFlight }) => reportBatchProgress(completed, inFlight),
  });

  const merged = await hierarchicalMerge(model, batchSummaries, query, (completed, total, inFlight) => {
    onProgress?.({
      phase: "merge",
      completed,
      inFlight,
      concurrency,
      total,
      rowsProcessed: allRows.length,
      totalRows: allRows.length,
    });
  });

  const summaryBody =
    merged.length === 1
      ? merged[0]
      : merged.map((s, i) => `### 통합 요약 ${i + 1}/${merged.length}\n${s}`).join("\n\n");

  const sheetList = sheets
    .map((s) => `- ${s.fileName} / ${s.sheetName}: ${s.rows.length.toLocaleString()}행`)
    .join("\n");

  const text = [
    "### 커뮤니티 게시글 전체 분석 (Map-Reduce)",
    "",
    `- **전체 ${allRows.length.toLocaleString()}행을 ${batches.length}개 배치로 모두 읽고 요약했습니다.**`,
    "- 아래 요약은 업로드 데이터 **전 행**을 빠짐없이 배치에 넣어 생성한 것입니다.",
    `- 사용자 질문: ${query}`,
    "",
    "#### 포함 파일",
    sheetList,
    "",
    "#### 전체 요약",
    summaryBody,
  ].join("\n");

  return {
    text,
    rowsProcessed: allRows.length,
    batchesProcessed: batches.length,
  };
}
