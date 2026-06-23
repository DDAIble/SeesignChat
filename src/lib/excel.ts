import * as XLSX from "xlsx";
import {
  buildCommunityDatasetOverview,
  sheetLooksLikeCommunityPosts,
} from "./community-analysis";
import {
  buildQAInsightsReport,
  buildQASchemaGuide,
  buildLectureWhyDigestsFromMessages,
  buildTextbookWhyDigestsFromMessages,
  compactRowForAI,
  findQALocationColumns,
  prioritizeRowsForAI,
  sheetLooksLikeQA,
} from "./qa-location";
import type { ExcelData, SheetData } from "./types";

const DEFAULT_MAX_CONTEXT_CHARS = 600_000;
const DEFAULT_MAX_BODY_CHARS = 2000;

export interface AIContextMeta {
  totalRows: number;
  scannedRows: number;
  includedRows: number;
  truncated: boolean;
  communityRows: number;
  ragChunks: number;
}

export interface AIContextResult {
  text: string;
  meta: AIContextMeta;
}

type RowContextMode = "qa" | "raw";

function getMaxContextChars(): number {
  const env = process.env.GEMINI_MAX_CONTEXT_CHARS;
  if (!env) return DEFAULT_MAX_CONTEXT_CHARS;
  const parsed = Number(env);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONTEXT_CHARS;
}

function getMaxBodyChars(): number {
  const env = process.env.GEMINI_MAX_BODY_CHARS;
  if (!env) return DEFAULT_MAX_BODY_CHARS;
  const parsed = Number(env);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BODY_CHARS;
}

function compactRowForContext(
  row: Record<string, unknown>,
  headers: string[],
  mode: RowContextMode,
  maxBodyChars: number
): Record<string, unknown> {
  if (mode === "qa") return compactRowForAI(row, headers, maxBodyChars);
  return row;
}

function fitRowsToBudget(
  rows: Record<string, unknown>[],
  headers: string[],
  mode: RowContextMode,
  budget: number,
  maxBodyChars: number
): { json: string; included: number } {
  if (budget <= 0 || rows.length === 0) {
    return { json: "[]", included: 0 };
  }

  const ordered = mode === "qa" ? prioritizeRowsForAI(rows, headers) : rows;
  const included: Record<string, unknown>[] = [];

  for (const row of ordered) {
    const compact = compactRowForContext(row, headers, mode, maxBodyChars);
    const next = [...included, compact];
    const serialized = JSON.stringify(next, null, 2);
    if (serialized.length > budget) break;
    included.push(compact);
  }

  if (included.length === 0 && ordered.length > 0) {
    const single = compactRowForContext(ordered[0], headers, mode, Math.min(maxBodyChars, 500));
    return { json: JSON.stringify([single], null, 2), included: 1 };
  }

  return { json: JSON.stringify(included, null, 2), included: included.length };
}

export function parseExcelBuffer(buffer: ArrayBuffer, fileName: string): ExcelData {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });

  const sheets: SheetData[] = workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name];
    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: "",
      raw: false,
    });

    const headers =
      jsonData.length > 0
        ? Object.keys(jsonData[0])
        : (XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1 })[0] as string[]) ?? [];

    return {
      name,
      headers,
      rows: jsonData,
      rowCount: jsonData.length,
    };
  });

  return {
    id: crypto.randomUUID(),
    fileName,
    sheets,
    uploadedAt: new Date().toISOString(),
  };
}

function buildSingleFileContext(
  data: ExcelData,
  budget: { remaining: number },
  meta: AIContextMeta
): string {
  const parts: string[] = [
    `파일명: ${data.fileName}`,
    `업로드 시간: ${data.uploadedAt}`,
    `시트 수: ${data.sheets.length}`,
    "",
  ];

  for (const sheet of data.sheets) {
    parts.push(`## 시트: "${sheet.name}"`);
    parts.push(`- 총 행 수: ${sheet.rowCount}`);
    parts.push(`- 컬럼: ${sheet.headers.join(", ") || "(없음)"}`);

    meta.totalRows += sheet.rowCount;
    meta.scannedRows += sheet.rowCount;

    if (sheet.rows.length === 0) {
      parts.push("- 데이터: (비어 있음)");
      parts.push("");
      continue;
    }

    const isCommunity = sheetLooksLikeCommunityPosts(sheet.headers);
    const isQA = !isCommunity && sheetLooksLikeQA(sheet.headers, sheet.rows);
    const mode: RowContextMode = isQA ? "qa" : "raw";
    const maxBodyChars = getMaxBodyChars();
    const prefixParts: string[] = [];

    if (isCommunity) {
      meta.communityRows += sheet.rowCount;
      const { report } = buildCommunityDatasetOverview(sheet.rows, sheet.headers);
      prefixParts.push(
        "- 데이터 유형: **커뮤니티 게시글** — 본문·주제 분석은 **RAG(임베딩 검색)** 으로 질문 관련 행을 찾습니다."
      );
      prefixParts.push(report);
      prefixParts.push("");
      parts.push(...prefixParts);
      parts.push("");
      continue;
    }

    if (isQA) {
      prefixParts.push("- 데이터 유형: Q&A (교재·강의 위치 전용 컬럼 자동 파싱 적용)");
      const qaColumns = findQALocationColumns(sheet.headers);
      prefixParts.push(buildQASchemaGuide(qaColumns));
      prefixParts.push("");
      const insightsReport = buildQAInsightsReport(sheet.rows, sheet.headers);
      if (insightsReport) {
        prefixParts.push(insightsReport);
        prefixParts.push("");
      }
      prefixParts.push(
        "- **인사이트 리포트는 전체 Q&A 행 기준 사전 집계**입니다. '어디서 질문이 많은지' 분석은 **순위표의 '질문 수' 열**만 사용하세요.",
        "- '왜 질문이 많은지' 분석은 리포트 **'질문 본문 종합' 섹션**(해당 위치 전체 본문)을 읽고 패턴을 도출하세요.",
        "- 아래 상세 행 목록은 토큰 한도 내 일부만 포함될 수 있습니다."
      );
      prefixParts.push("");
    }

    const prefixText = prefixParts.join("\n");
    const prefixLen = prefixText.length + 100;
    const rowBudget = Math.max(0, budget.remaining - prefixLen);

    const { json, included } = fitRowsToBudget(
      sheet.rows,
      sheet.headers,
      mode,
      rowBudget,
      maxBodyChars
    );

    meta.includedRows += included;
    if (included < sheet.rowCount) meta.truncated = true;

    parts.push(...prefixParts);

    if (included < sheet.rowCount) {
      parts.push(
        `- 데이터 상세: **${included}행 / 전체 ${sheet.rowCount}행** 포함 (토큰 한도로 ${sheet.rowCount - included}행 생략)`
      );
      if (isQA) {
        parts.push(
          "- 생략된 행이 있어도 **Q&A 인사이트 리포트**는 전체 데이터 기준입니다. 핫스팟 순위·강사 인사이트는 리포트를 우선 활용하세요."
        );
      }
    } else {
      parts.push(`- 데이터 (전체 ${sheet.rowCount}행):`);
    }

    parts.push(json);
    parts.push("");

    budget.remaining -= prefixText.length + json.length + 200;
  }

  return parts.join("\n");
}

export function buildAIContext(
  files: ExcelData[],
  userTexts: string[] = []
): AIContextResult {
  const meta: AIContextMeta = {
    totalRows: 0,
    scannedRows: 0,
    includedRows: 0,
    truncated: false,
    communityRows: 0,
    ragChunks: 0,
  };
  const budget = { remaining: getMaxContextChars() };

  if (files.length === 0) {
    return { text: "", meta };
  }

  const parts: string[] = [];

  if (files.length > 1) {
    parts.push(`총 ${files.length}개의 파일이 업로드되었습니다.`, "");
  }

  files.forEach((file, index) => {
    if (files.length > 1) parts.push(`# 파일 ${index + 1}`);
    parts.push(buildSingleFileContext(file, budget, meta));
    if (files.length > 1) {
      parts.push("---", "");
    }
  });

  if (meta.communityRows > 0) {
    parts.unshift(
      `📋 커뮤니티 게시글 **${meta.communityRows.toLocaleString()}행** — 질문 관련 본문은 RAG 검색으로 가져옵니다.`,
      ""
    );
  } else if (meta.truncated) {
    parts.unshift(
      `⚠️ 상세 행 JSON은 ${meta.includedRows.toLocaleString()}행만 포함했지만, Q&A 인사이트 리포트는 ${meta.scannedRows.toLocaleString()}행 전수 기준입니다.`,
      ""
    );
  } else if (meta.scannedRows > 0) {
    parts.unshift(`✅ 업로드 데이터 **${meta.scannedRows.toLocaleString()}행**을 서버에서 읽었습니다.`, "");
  }

  if (userTexts.length > 0) {
    const whyParts: string[] = [];
    for (const file of files) {
      for (const sheet of file.sheets) {
        if (sheetLooksLikeCommunityPosts(sheet.headers)) continue;

        const textbookDigest = buildTextbookWhyDigestsFromMessages(
          sheet.rows,
          sheet.headers,
          userTexts
        );
        const lectureDigest = buildLectureWhyDigestsFromMessages(
          sheet.rows,
          sheet.headers,
          userTexts
        );
        if (textbookDigest) whyParts.push(textbookDigest);
        if (lectureDigest) whyParts.push(lectureDigest);
      }
    }
    if (whyParts.length > 0) {
      parts.push("", ...whyParts);
    }
  }

  return { text: parts.join("\n"), meta };
}

export function appendRAGContext(
  baseContext: string,
  ragText: string,
  meta: AIContextMeta,
  chunkCount: number
): string {
  meta.ragChunks = chunkCount;
  if (!ragText.trim()) {
    return baseContext;
  }
  return `${baseContext}\n\n${ragText}`;
}
