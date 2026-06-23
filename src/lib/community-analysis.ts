import type { ExcelData } from "./types";

function getField(row: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const val = row[name];
    if (val !== undefined && val !== null && String(val).trim()) {
      return String(val).trim();
    }
  }
  return "";
}

function truncateText(value: unknown, maxChars: number): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

export function sheetLooksLikeCommunityPosts(headers: string[]): boolean {
  const headerText = headers.join(" ");
  const hasPostSignals = /게시판|커뮤니티|댓글내용|조회수|추천수/.test(headerText);
  const hasText = headers.some((h) => h === "본문" || h === "제목");
  const hasQALocation = headers.some((h) =>
    /질문\s*대상.*교재|질문\s*대상.*강의|^세부교재$|^세부강좌명$/i.test(h)
  );
  return hasPostSignals && hasText && !hasQALocation;
}

export interface CommunitySheetData {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

export function collectCommunitySheets(files: ExcelData[]): CommunitySheetData[] {
  const sheets: CommunitySheetData[] = [];

  for (const file of files) {
    for (const sheet of file.sheets) {
      if (!sheetLooksLikeCommunityPosts(sheet.headers) || sheet.rows.length === 0) continue;
      sheets.push({
        fileName: file.fileName,
        sheetName: sheet.name,
        headers: sheet.headers,
        rows: sheet.rows,
      });
    }
  }

  return sheets;
}

function countByField(rows: Record<string, unknown>[], field: string, limit = 15): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = getField(row, field);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function countLabelColumns(rows: Record<string, unknown>[], headers: string[]): string[] {
  const labelHeaders = headers.filter((h) => h.startsWith("라벨-"));
  if (labelHeaders.length === 0 || rows.length === 0) return [];

  const parts: string[] = ["", "#### 라벨 분포 (전체)", ""];
  for (const header of labelHeaders.slice(0, 8)) {
    const counts = countByField(rows, header, 8);
    if (counts.length === 0) continue;
    parts.push(`- **${header.replace(/^라벨-/, "")}** TOP: ${counts.map(([k, n]) => `${k}(${n})`).join(", ")}`);
  }
  return parts;
}

export interface CommunityOverviewMeta {
  totalRows: number;
}

export function buildCommunityDatasetOverview(
  rows: Record<string, unknown>[],
  headers: string[]
): { report: string; meta: CommunityOverviewMeta } {
  const parts: string[] = [
    "### 커뮤니티 게시글 데이터 개요 (전체 행 스캔)",
    "",
    `**전체 ${rows.length.toLocaleString()}행**을 서버에서 읽었습니다.`,
    "- 본문·주제 분석은 **RAG(임베딩 검색)** 으로 질문 관련 행을 찾습니다.",
    "",
  ];

  const boardCounts = countByField(rows, "게시판", 12);
  if (boardCounts.length > 0) {
    parts.push(
      "#### 게시판 분포",
      "",
      boardCounts.map(([name, count]) => `- ${name}: **${count}건**`).join("\n"),
      ""
    );
  }

  const communityCounts = countByField(rows, "커뮤니티", 8);
  if (communityCounts.length > 0) {
    parts.push(
      "#### 커뮤니티 분포",
      "",
      communityCounts.map(([name, count]) => `- ${name}: **${count}건**`).join("\n"),
      ""
    );
  }

  const keywordColumnCounts = countByField(
    rows.filter((row) => getField(row, "키워드")),
    "키워드",
    15
  );
  if (keywordColumnCounts.length > 0) {
    parts.push(
      "#### 데이터 키워드 컬럼 TOP",
      "",
      keywordColumnCounts.map(([name, count]) => `- ${name}: ${count}건`).join("\n"),
      ""
    );
  }

  parts.push(...countLabelColumns(rows, headers));

  return {
    report: parts.join("\n"),
    meta: { totalRows: rows.length },
  };
}

const DEFAULT_CHARS_PER_ROW = 280;

function getCharsPerRow(): number {
  const env = process.env.COMMUNITY_MAP_CHARS_PER_ROW;
  if (!env) return DEFAULT_CHARS_PER_ROW;
  const parsed = Number(env);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CHARS_PER_ROW;
}

export function formatRowForBatch(row: Record<string, unknown>, rowIndex: number): string {
  const maxChars = getCharsPerRow();
  const title = getField(row, "제목");
  const board = getField(row, "게시판");
  const community = getField(row, "커뮤니티");
  const date = getField(row, "게시날짜");
  const body = truncateText(getField(row, "본문"), Math.floor(maxChars * 0.65));
  const comment = truncateText(getField(row, "댓글내용", "댓글"), Math.floor(maxChars * 0.25));
  const keyword = getField(row, "키워드");

  const meta = [date, community, board].filter(Boolean).join(" | ");
  const extras = [keyword ? `키워드:${keyword}` : "", comment ? `댓글:${comment}` : ""]
    .filter(Boolean)
    .join(" ");

  const line = `[${rowIndex}] ${meta ? `(${meta}) ` : ""}${title || "(제목 없음)"} — ${body || "(본문 없음)"}${extras ? ` | ${extras}` : ""}`;
  return truncateText(line, maxChars + 80);
}

export function chunkRows<T>(rows: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    batches.push(rows.slice(i, i + batchSize));
  }
  return batches;
}
