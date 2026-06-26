import { sheetLooksLikeCommunityPosts } from "./community-analysis";
import { sheetLooksLikeQA } from "./qa-location";
import type { ExcelData, SheetData } from "./types";

const QUANT_FULL_ROW_LIMIT = Number(process.env.QUANT_FULL_ROW_LIMIT) || 5_000;

const QUANT_QUERY_RE =
  /매출|수익|매출액|통계|추이|트렌드|건수|비율|합계|평균|중앙값|최대|최소|최고|최저|월별|연별|분기|증감|성장|전년|전월|yoy|mom|revenue|sales|amount|count|trend|stat|numeric|수치|그래프|차트|표로|집계|합산|총액|거래|판매|실적|성과|비교.*수|수치.*분석|분석.*수치/i;

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

function buildNumericSummaries(
  rows: Record<string, unknown>[],
  headers: string[]
): string[] {
  const lines: string[] = ["#### 수치 컬럼 요약 (전체 행 기준)", ""];
  let added = false;

  for (const header of headers) {
    if (!isMostlyNumericColumn(rows, header)) continue;
    const values = rows
      .map((row) => parseNumeric(row[header]))
      .filter((value): value is number => value !== null);
    if (values.length === 0) continue;

    const sum = values.reduce((acc, value) => acc + value, 0);
    const avg = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    lines.push(
      `- **${header}**: 합계 ${sum.toLocaleString("ko-KR")} · 평균 ${avg.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} · 최소 ${min.toLocaleString("ko-KR")} · 최대 ${max.toLocaleString("ko-KR")}`
    );
    added = true;
  }

  if (!added) return [];
  lines.push("");
  return lines;
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
  sheet: SheetData
): { text: string; rowCount: number } | null {
  if (!sheetLooksLikeQuantitative(sheet.headers, sheet.rows, fileName)) return null;

  const parts = [
    `### [정량] ${fileName} / 시트 "${sheet.name}"`,
    "",
    `- **전체 ${sheet.rowCount.toLocaleString()}행**을 서버에서 전수 집계했습니다. (청크·RAG 샘플 아님)`,
    `- 컬럼: ${sheet.headers.join(", ")}`,
    "",
    ...buildNumericSummaries(sheet.rows, sheet.headers),
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

export function buildQuantitativeReport(files: ExcelData[]): {
  text: string;
  rowCount: number;
  sheetCount: number;
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

  for (const file of files) {
    for (const sheet of file.sheets) {
      const section = buildQuantitativeSheetSection(file.fileName, sheet);
      if (!section) continue;
      sections.push(section.text, "");
      rowCount += section.rowCount;
      sheetCount += 1;
    }
  }

  if (sheetCount === 0) {
    return { text: "", rowCount: 0, sheetCount: 0 };
  }

  return { text: sections.join("\n"), rowCount, sheetCount };
}

export function fileHasQuantitativeSheets(file: ExcelData): boolean {
  return file.sheets.some((sheet) =>
    sheetLooksLikeQuantitative(sheet.headers, sheet.rows, file.fileName)
  );
}
