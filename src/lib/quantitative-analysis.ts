import { sheetLooksLikeCommunityPosts } from "./community-analysis";
import { buildCellsFromRow } from "./chunking";
import type { CitationSource } from "./citations";
import { sheetLooksLikeQA } from "./qa-location";
import type { ExcelData, SheetData } from "./types";

const QUANT_FULL_ROW_LIMIT = Number(process.env.QUANT_FULL_ROW_LIMIT) || 5_000;
/** 정량 시트 버킷 모달에 표시할 최대 행 수 */
const MAX_QUANT_BUCKET_ROWS = 200;

/** 범주형(그룹 키) 후보로 인정할 고유값 개수 범위 */
const GROUPBY_MIN_CARDINALITY = 2;
const GROUPBY_MAX_CARDINALITY = 40;
/** 그룹 집계표를 만들 범주형 컬럼 최대 개수 */
const MAX_GROUPBY_COLUMNS = 4;
/** 범주형 컬럼당 표에 표시할 최대 그룹(행) 수 */
const MAX_GROUPS_PER_COLUMN = 15;
/** 그룹 집계에 교차할 수치 컬럼 최대 개수 */
const MAX_GROUPBY_METRICS = 3;
/** 범주형 판정 시 자유 서술(본문)로 간주해 제외할 평균 문자 길이 */
const CATEGORICAL_MAX_AVG_LEN = 30;

const QUANT_QUERY_RE =
  /매출|수익|매출액|통계|추이|트렌드|건수|비율|합계|평균|중앙값|최대|최소|최고|최저|월별|연별|분기|증감|성장|전년|전월|yoy|mom|revenue|sales|amount|count|trend|stat|numeric|수치|그래프|차트|표로|집계|합산|총액|거래|판매|실적|성과|비교.*수|수치.*분석|분석.*수치|언급|일별|주별|날짜별|며칠|몇\s*건|몇건/i;

const QUAL_QUERY_RE =
  /왜|이유|인사이트|감성|니즈|욕구|불만|칭찬|본문|여론|반응|키워드|주제|말해|언급|아바타|페르소나|limiting belief|desire|막힌|왜.*많/i;

export function isQuantitativeAnalysisQuery(query: string): boolean {
  const text = query.trim();
  if (!text) return false;
  const quant = QUANT_QUERY_RE.test(text);
  const qual = QUAL_QUERY_RE.test(text);
  if (quant && !qual) return true;
  if (quant && qual && /매출|수익|통계|추이|트렌드|건수|비율|실적|수치|그래프|차트/.test(text)) {
    return true;
  }
  return false;
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").replace(/%/g, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isMostlyNumericColumn(rows: Record<string, unknown>[], header: string): boolean {
  const sample = rows.slice(0, Math.min(rows.length, 80));
  if (sample.length === 0) return false;

  let numeric = 0;
  for (const row of sample) {
    if (parseNumeric(row[header]) !== null) numeric += 1;
  }
  return numeric / sample.length >= 0.55;
}

export function sheetLooksLikeQuantitative(
  headers: string[],
  rows: Record<string, unknown>[],
  fileName = ""
): boolean {
  if (sheetLooksLikeCommunityPosts(headers)) return false;
  if (sheetLooksLikeQA(headers, rows)) return false;

  const headerText = headers.join(" ");
  const nameHint = /stats|stat|통계|매출|revenue|sales|집계|summary|실적|월별|연별|qna_stats/i.test(
    fileName
  );
  const headerHint =
    /월|연|기간|날짜|date|month|year|분기|건수|count|매출|amount|비율|rate|합계|total|수량|qty|값|value/i.test(
      headerText
    );

  const numericColumns = headers.filter((header) => isMostlyNumericColumn(rows, header));
  if (nameHint && numericColumns.length > 0) return true;
  if (headerHint && numericColumns.length > 0) return true;
  if (numericColumns.length >= 2 && numericColumns.length / Math.max(headers.length, 1) >= 0.35) {
    return true;
  }

  return rows.length > 0 && rows.length <= 120 && numericColumns.length >= 1 && !/본문|제목|댓글/.test(headerText);
}

function escapeCell(value: unknown): string {
  const text = String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  return text || "-";
}

function fmt(value: number, fractionDigits = 2): string {
  return value.toLocaleString("ko-KR", { maximumFractionDigits: fractionDigits });
}

function median(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sortedAsc[mid - 1] + sortedAsc[mid]) / 2 : sortedAsc[mid];
}

function stddev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

interface NumericColumnStats {
  header: string;
  values: number[];
  sum: number;
  avg: number;
  min: number;
  max: number;
  med: number;
  std: number;
}

function computeNumericColumnStats(
  rows: Record<string, unknown>[],
  headers: string[]
): NumericColumnStats[] {
  const stats: NumericColumnStats[] = [];
  for (const header of headers) {
    if (!isMostlyNumericColumn(rows, header)) continue;
    const values = rows
      .map((row) => parseNumeric(row[header]))
      .filter((value): value is number => value !== null);
    if (values.length === 0) continue;

    const sum = values.reduce((acc, value) => acc + value, 0);
    const avg = sum / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    stats.push({
      header,
      values,
      sum,
      avg,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      med: median(sorted),
      std: stddev(values, avg),
    });
  }
  return stats;
}

function buildNumericSummaries(numericStats: NumericColumnStats[]): string[] {
  if (numericStats.length === 0) return [];
  const lines: string[] = ["#### 수치 컬럼 요약 (전체 행 기준)", ""];

  for (const s of numericStats) {
    lines.push(
      `- **${s.header}**: 합계 ${fmt(s.sum, 2)} · 평균 ${fmt(s.avg)} · 중앙값 ${fmt(s.med)} · 표준편차 ${fmt(s.std)} · 최소 ${fmt(s.min)} · 최대 ${fmt(s.max)} · 유효값 ${s.values.length.toLocaleString("ko-KR")}개`
    );
  }

  lines.push("");
  return lines;
}

function normalizeCategory(value: unknown): string {
  return String(value ?? "").trim();
}

interface CategoricalColumn {
  header: string;
  /** 값 → 건수 (전체 행 전수 집계) */
  counts: Map<string, number>;
}

/**
 * 그룹 키로 쓸 수 있는 범주형 컬럼을 감지합니다.
 * - 수치 컬럼 제외, 고유값이 너무 적/많으면 제외(2~40)
 * - 값 평균 길이가 길면(자유 서술/본문) 제외
 */
function detectCategoricalColumns(
  rows: Record<string, unknown>[],
  headers: string[]
): CategoricalColumn[] {
  const result: CategoricalColumn[] = [];

  for (const header of headers) {
    if (isMostlyNumericColumn(rows, header)) continue;

    const counts = new Map<string, number>();
    let nonEmpty = 0;
    let totalLen = 0;

    for (const row of rows) {
      const raw = normalizeCategory(row[header]);
      if (!raw) continue;
      nonEmpty += 1;
      totalLen += raw.length;
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }

    if (nonEmpty === 0) continue;
    const cardinality = counts.size;
    if (cardinality < GROUPBY_MIN_CARDINALITY || cardinality > GROUPBY_MAX_CARDINALITY) {
      continue;
    }
    if (totalLen / nonEmpty > CATEGORICAL_MAX_AVG_LEN) continue;

    result.push({ header, counts });
  }

  return result;
}

function topEntries(counts: Map<string, number>, limit: number): [string, number][] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function buildDistributionSummaries(categoricals: CategoricalColumn[]): string[] {
  if (categoricals.length === 0) return [];
  const lines: string[] = ["#### 범주 분포 (전체 행 기준, 건수 내림차순)", ""];

  for (const col of categoricals.slice(0, MAX_GROUPBY_COLUMNS)) {
    const top = topEntries(col.counts, MAX_GROUPS_PER_COLUMN);
    const rendered = top
      .map(([value, count]) => `${escapeCell(value)} ${count.toLocaleString("ko-KR")}건`)
      .join(" · ");
    const more =
      col.counts.size > top.length ? ` · 외 ${col.counts.size - top.length}개 값` : "";
    lines.push(`- **${col.header}** (${col.counts.size}개 값): ${rendered}${more}`);
  }

  lines.push("");
  return lines;
}

/**
 * 범주형 컬럼 × 수치 컬럼 교차 그룹 집계표.
 * 예) "카테고리별 매출 합계·평균", "지역별 건수" 를 결정적으로 전수 계산.
 */
function buildGroupByBreakdowns(
  rows: Record<string, unknown>[],
  categoricals: CategoricalColumn[],
  numericStats: NumericColumnStats[]
): string[] {
  if (categoricals.length === 0) return [];

  const metrics = numericStats.slice(0, MAX_GROUPBY_METRICS);
  const lines: string[] = ["#### 범주별 그룹 집계 (전체 행 전수, 이 표의 수치만 사용)", ""];
  let added = false;

  for (const col of categoricals.slice(0, MAX_GROUPBY_COLUMNS)) {
    const groups = topEntries(col.counts, MAX_GROUPS_PER_COLUMN);
    if (groups.length === 0) continue;

    const metricSums = new Map<string, Map<string, { sum: number; n: number }>>();
    for (const metric of metrics) {
      metricSums.set(metric.header, new Map());
    }

    if (metrics.length > 0) {
      const groupKeys = new Set(groups.map(([value]) => value));
      for (const row of rows) {
        const key = normalizeCategory(row[col.header]);
        if (!groupKeys.has(key)) continue;
        for (const metric of metrics) {
          const value = parseNumeric(row[metric.header]);
          if (value === null) continue;
          const bucket = metricSums.get(metric.header)!;
          const cur = bucket.get(key) ?? { sum: 0, n: 0 };
          cur.sum += value;
          cur.n += 1;
          bucket.set(key, cur);
        }
      }
    }

    const headerCells = ["값", "건수", ...metrics.flatMap((m) => [`${m.header} 합계`, `${m.header} 평균`])];
    lines.push(`##### ${col.header}별`, "");
    lines.push(`| ${headerCells.map(escapeCell).join(" | ")} |`);
    lines.push(`| ${headerCells.map(() => "---").join(" | ")} |`);

    for (const [value, count] of groups) {
      const cells = [escapeCell(value), count.toLocaleString("ko-KR")];
      for (const metric of metrics) {
        const agg = metricSums.get(metric.header)!.get(value);
        if (agg && agg.n > 0) {
          cells.push(fmt(agg.sum, 2), fmt(agg.sum / agg.n));
        } else {
          cells.push("-", "-");
        }
      }
      lines.push(`| ${cells.join(" | ")} |`);
    }

    if (col.counts.size > groups.length) {
      lines.push("", `- 참고: 상위 ${groups.length}개 그룹만 표시 (총 ${col.counts.size}개 값).`);
    }
    lines.push("");
    added = true;
  }

  return added ? lines : [];
}

function buildFullTable(sheet: SheetData): string[] {
  const displayHeaders = sheet.headers.slice(0, 20);
  const lines = [
    `#### 전체 데이터 표 (${sheet.rowCount.toLocaleString()}행 전수)`,
    "",
    `| ${displayHeaders.map(escapeCell).join(" | ")} |`,
    `| ${displayHeaders.map(() => "---").join(" | ")} |`,
  ];

  for (const row of sheet.rows) {
    lines.push(
      `| ${displayHeaders.map((header) => escapeCell(row[header])).join(" | ")} |`
    );
  }

  if (sheet.headers.length > displayHeaders.length) {
    lines.push(
      "",
      `- 참고: 컬럼 ${sheet.headers.length}개 중 앞 ${displayHeaders.length}개만 표에 표시했습니다.`
    );
  }

  lines.push("");
  return lines;
}

function buildQuantitativeSheetSection(
  fileName: string,
  sheet: SheetData,
  evidenceIndex: number
): { text: string; rowCount: number } | null {
  if (!sheetLooksLikeQuantitative(sheet.headers, sheet.rows, fileName)) return null;

  const numericStats = computeNumericColumnStats(sheet.rows, sheet.headers);
  const categoricals = detectCategoricalColumns(sheet.rows, sheet.headers);

  const parts = [
    `### [정량] ${fileName} / 시트 "${sheet.name}"`,
    "",
    `- **전체 ${sheet.rowCount.toLocaleString()}행**을 서버에서 전수 집계했습니다. (청크·RAG 샘플 아님)`,
    `- 컬럼: ${sheet.headers.join(", ")}`,
    `- **출처**: 이 시트의 수치·통계를 언급한 문장 끝에 \`[근거 ${evidenceIndex}]\` 태그를 붙이세요.`,
    "",
    ...buildNumericSummaries(numericStats),
    ...buildDistributionSummaries(categoricals),
    ...buildGroupByBreakdowns(sheet.rows, categoricals, numericStats),
  ];

  if (sheet.rowCount <= QUANT_FULL_ROW_LIMIT) {
    parts.push(...buildFullTable(sheet));
  } else {
    parts.push(
      `- 행 수가 ${QUANT_FULL_ROW_LIMIT.toLocaleString()}행을 초과하여 상세 표 대신 **수치 요약**만 제공합니다.`,
      "- 정확한 행 단위 분석이 필요하면 파일을 기간·구간별로 나눠 업로드하세요.",
      ""
    );
  }

  return { text: parts.join("\n"), rowCount: sheet.rowCount };
}

function buildQuantitativeSheetCitation(
  index: number,
  fileName: string,
  sheet: SheetData
): CitationSource {
  const capped = sheet.rows.slice(0, MAX_QUANT_BUCKET_ROWS);
  return {
    index,
    fileName,
    sheetName: sheet.name,
    rowIndex: 1,
    rowEnd: capped.length,
    title: `${sheet.name} 전체 ${sheet.rowCount.toLocaleString()}행`,
    body: `${sheet.name} 정량 데이터 ${sheet.rowCount.toLocaleString()}행`,
    headers: sheet.headers,
    rows: capped.map((row, offset) => ({
      rowIndex: offset + 1,
      title: "-",
      body: "",
      date: "",
      community: "",
      cells: buildCellsFromRow(row, sheet.headers),
    })),
  };
}

export function buildQuantitativeReport(
  files: ExcelData[],
  indexBase = 1
): {
  text: string;
  rowCount: number;
  sheetCount: number;
  citations: CitationSource[];
} {
  const sections: string[] = [
    "### 전수 통계 리포트 (정량 데이터 — 전체 행 서버 집계)",
    "",
    "- 아래 수치·표는 **업로드 파일 전체 행**을 기준으로 합니다.",
    "- 매출·통계·추이·비율 질문은 **이 섹션만** 근거로 답하세요. RAG 청크·게시글 본문 샘플로 수치를 추정하지 마세요.",
    "- 마케팅 페르소나·욕구·Limiting Belief 같은 **정성 프레임은 사용하지 마세요.**",
    "",
  ];

  let rowCount = 0;
  let sheetCount = 0;
  const citations: CitationSource[] = [];
  let nextIndex = indexBase;

  for (const file of files) {
    for (const sheet of file.sheets) {
      const evidenceIndex = nextIndex;
      const section = buildQuantitativeSheetSection(file.fileName, sheet, evidenceIndex);
      if (!section) continue;
      sections.push(section.text, "");
      rowCount += section.rowCount;
      sheetCount += 1;
      citations.push(buildQuantitativeSheetCitation(evidenceIndex, file.fileName, sheet));
      nextIndex += 1;
    }
  }

  if (sheetCount === 0) {
    return { text: "", rowCount: 0, sheetCount: 0, citations: [] };
  }

  return { text: sections.join("\n"), rowCount, sheetCount, citations };
}

export function fileHasQuantitativeSheets(file: ExcelData): boolean {
  return file.sheets.some((sheet) =>
    sheetLooksLikeQuantitative(sheet.headers, sheet.rows, file.fileName)
  );
}
