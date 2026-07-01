import { formatRowForBatch, formatRowForRAG, sheetLooksLikeCommunityPosts } from "./community-analysis";
import type { CitationRowData } from "./citations";
import { compactRowForAI, sheetLooksLikeQA } from "./qa-location";
import type { ExcelData } from "./types";

export type ChunkDataType = "community" | "qa" | "general";

export interface ChunkDraft {
  id: string;
  fileId: string;
  fileName: string;
  sheetName: string;
  rowIndex: number;
  rowEnd: number;
  text: string;
  title: string;
  body: string;
  citationRows: CitationRowData[];
  headers: string[];
  dataType: ChunkDataType;
}

export function buildCellsFromRow(
  row: Record<string, unknown>,
  headers: string[]
): Record<string, string> {
  const cells: Record<string, string> = {};
  for (const header of headers) {
    const value = row[header];
    cells[header] = value === undefined || value === null ? "" : String(value).trim();
  }
  return cells;
}

const DEFAULT_MAX_CHUNK_CHARS = 8_000;
const DEFAULT_ROWS_PER_CHUNK = 25;

function getMaxChunkChars(): number {
  const parsed = Number(process.env.RAG_MAX_CHUNK_CHARS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CHUNK_CHARS;
}

function getRowsPerChunk(): number {
  const parsed = Number(process.env.RAG_ROWS_PER_CHUNK);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ROWS_PER_CHUNK;
}

function shouldIndexQA(): boolean {
  return process.env.RAG_INDEX_QA === "true";
}

/** 대용량 Q&A 시트는 의미검색 임베딩을 생략합니다 (핫스팟·통계는 전수 집계로 동작). */
const DEFAULT_MAX_QA_INDEX_ROWS = 5000;

function getMaxQAIndexRows(): number {
  const parsed = Number(process.env.RAG_MAX_QA_INDEX_ROWS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_QA_INDEX_ROWS;
}

function getField(row: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const val = row[name];
    if (val !== undefined && val !== null && String(val).trim()) {
      return String(val).trim();
    }
  }
  return "";
}

function extractRowCitation(
  row: Record<string, unknown>,
  headers: string[],
  dataType: ChunkDataType
): { title: string; body: string } {
  if (dataType === "community") {
    return {
      title: getField(row, "제목") || "(제목 없음)",
      body: getField(row, "본문") || getField(row, "댓글내용", "댓글"),
    };
  }

  if (dataType === "qa") {
    return {
      title: getField(row, "제목", "질문") || "(제목 없음)",
      body: getField(row, "본문", "질문내용", "내용"),
    };
  }

  const title =
    getField(row, "제목", "title", "Title") ||
    getField(row, headers[0] ?? "") ||
    "(제목 없음)";
  const body =
    getField(row, "본문", "내용", "body", "Body") ||
    headers
      .slice(1, 4)
      .map((h) => getField(row, h))
      .filter(Boolean)
      .join(" · ");

  return { title, body };
}

function extractRowForTable(
  row: Record<string, unknown>,
  headers: string[],
  dataType: ChunkDataType,
  rowIndex: number
): CitationRowData {
  const cells = buildCellsFromRow(row, headers);

  if (dataType === "community") {
    return {
      rowIndex,
      title: getField(row, "제목") || "-",
      body: getField(row, "본문"),
      date: getField(row, "게시날짜", "날짜", "작성일"),
      community: getField(row, "커뮤니티"),
      cells,
    };
  }

  if (dataType === "qa") {
    return {
      rowIndex,
      title: getField(row, "제목", "질문") || "-",
      body: getField(row, "본문", "질문내용", "내용"),
      date: getField(row, "게시날짜", "날짜", "작성일"),
      community: getField(row, "커뮤니티", "게시판"),
      cells,
    };
  }

  return {
    rowIndex,
    title: getField(row, "제목", "title", "Title") || getField(row, headers[0] ?? "") || "-",
    body:
      getField(row, "본문", "내용", "body", "Body") ||
      headers
        .slice(1, 4)
        .map((h) => getField(row, h))
        .filter(Boolean)
        .join(" · "),
    date: getField(row, "게시날짜", "날짜", "date", "Date", "작성일"),
    community: getField(row, "커뮤니티", "community", "Community", "게시판"),
    cells,
  };
}

function buildCitationRows(
  rows: Record<string, unknown>[],
  headers: string[],
  dataType: ChunkDataType,
  startRowIndex: number
): CitationRowData[] {
  return rows.map((row, offset) =>
    extractRowForTable(row, headers, dataType, startRowIndex + offset)
  );
}

function summarizeChunkCitation(
  rows: Record<string, unknown>[],
  headers: string[],
  dataType: ChunkDataType,
  startRowIndex: number
): { title: string; body: string } {
  const first = extractRowCitation(rows[0], headers, dataType);

  if (rows.length === 1) {
    return {
      title: first.title,
      body: truncateText(first.body, 500),
    };
  }

  const body = rows
    .map((row, offset) => {
      const { title, body: rowBody } = extractRowCitation(row, headers, dataType);
      const label = title !== "(제목 없음)" ? title : `행 ${startRowIndex + offset}`;
      return rowBody ? `[${label}] ${rowBody}` : "";
    })
    .filter(Boolean)
    .join("\n\n");

  return {
    title: `${first.title} 외 ${rows.length - 1}건`,
    body: truncateText(body, 600),
  };
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}…`;
}

function formatGeneralRow(
  row: Record<string, unknown>,
  headers: string[],
  rowIndex: number
): string {
  const lines: string[] = [];
  for (const header of headers) {
    const value = row[header];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    lines.push(`${header}: ${truncateText(String(value).trim(), 400)}`);
  }
  return lines.join("\n");
}

function formatQARow(row: Record<string, unknown>, headers: string[]): string {
  const compact = compactRowForAI(row, headers, 800);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(compact)) {
    if (value === undefined || value === null || String(value).trim() === "") continue;
    lines.push(`${key}: ${truncateText(String(value).trim(), 400)}`);
  }
  return lines.join("\n");
}

function formatRowGroup(
  rows: Record<string, unknown>[],
  startRowIndex: number,
  headers: string[],
  dataType: ChunkDataType,
  fileName: string,
  sheetName: string
): string {
  const endRowIndex = startRowIndex + rows.length - 1;
  const header =
    rows.length === 1
      ? `[${fileName} / ${sheetName} / 행 ${startRowIndex}]`
      : `[${fileName} / ${sheetName} / 행 ${startRowIndex}~${endRowIndex}]`;

  const body = rows
    .map((row, offset) => {
      const rowIndex = startRowIndex + offset;
      if (dataType === "community") {
        return formatRowForRAG(row, rowIndex);
      }
      if (dataType === "qa") {
        return `--- 행 ${rowIndex} ---\n${formatQARow(row, headers)}`;
      }
      return `--- 행 ${rowIndex} ---\n${formatGeneralRow(row, headers, rowIndex)}`;
    })
    .join("\n");

  return truncateText(`${header}\n${body}`, getMaxChunkChars());
}

export function chunkExcelFile(data: ExcelData): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  const rowsPerChunk = getRowsPerChunk();

  for (const sheet of data.sheets) {
    if (sheet.rows.length === 0) continue;

    const isCommunity = sheetLooksLikeCommunityPosts(sheet.headers);
    const isQA = !isCommunity && sheetLooksLikeQA(sheet.headers, sheet.rows);

    if (isQA && !shouldIndexQA()) continue;
    // 대용량 Q&A는 임베딩(의미검색)을 생략 — 핫스팟·통계 분석은 전체 행 전수 집계로 그대로 동작
    if (isQA && sheet.rows.length > getMaxQAIndexRows()) continue;

    const dataType: ChunkDataType = isCommunity ? "community" : isQA ? "qa" : "general";

    for (let i = 0; i < sheet.rows.length; i += rowsPerChunk) {
      const group = sheet.rows.slice(i, i + rowsPerChunk);
      const startRowIndex = i + 1;
      const endRowIndex = i + group.length;
      const text = formatRowGroup(group, startRowIndex, sheet.headers, dataType, data.fileName, sheet.name);
      const citation = summarizeChunkCitation(group, sheet.headers, dataType, startRowIndex);
      const citationRows = buildCitationRows(group, sheet.headers, dataType, startRowIndex);

      if (!text.trim()) continue;

      chunks.push({
        id: `${data.id}:${sheet.name}:${startRowIndex}-${endRowIndex}`,
        fileId: data.id,
        fileName: data.fileName,
        sheetName: sheet.name,
        rowIndex: startRowIndex,
        rowEnd: endRowIndex,
        text,
        title: citation.title,
        body: citation.body,
        citationRows,
        headers: sheet.headers,
        dataType,
      });
    }
  }

  return chunks;
}

export function getChunkingSummary(): { rowsPerChunk: number; indexQA: boolean } {
  return { rowsPerChunk: getRowsPerChunk(), indexQA: shouldIndexQA() };
}
