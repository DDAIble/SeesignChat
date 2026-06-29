import type { CommunitySheetData } from "./community-analysis";
import { buildCellsFromRow } from "./chunking";
import type { CitationSource } from "./citations";
import {
  getCommunityField,
  normalizeTextForMatch,
  parseCommunityDate,
  rowMatchesKeyword,
} from "./community-text-utils";
import type { CommunityQueryIntent } from "./community-query-intent";

/** 버킷 1건 모달에 표시할 최대 행 수 (집계 건수 자체는 표가 정확) */
const MAX_BUCKET_ROWS = 200;

export interface CommunityAggregationMeta {
  totalRowsScanned: number;
  matchedRowCount: number;
  keywords: string[];
  labelFilter: string | null;
  dateFilter: string | null;
}

export interface CommunityAggregationReport {
  text: string;
  meta: CommunityAggregationMeta;
  citations: CitationSource[];
}

type MatchedRow = {
  sheet: CommunitySheetData;
  row: Record<string, unknown>;
  rowIndex: number;
};

function buildBucketCitation(
  index: number,
  sheet: CommunitySheetData,
  rows: MatchedRow[],
  label: string
): CitationSource {
  const capped = rows.slice(0, MAX_BUCKET_ROWS);
  const rowIndexes = capped.map((m) => m.rowIndex);
  return {
    index,
    fileName: sheet.fileName,
    sheetName: sheet.sheetName,
    rowIndex: Math.min(...rowIndexes),
    rowEnd: Math.max(...rowIndexes),
    title: label,
    body: label,
    headers: sheet.headers,
    rows: capped.map((m) => ({
      rowIndex: m.rowIndex,
      title: getCommunityField(m.row, "제목") || "-",
      body: getCommunityField(m.row, "본문"),
      date: getCommunityField(m.row, "게시날짜", "날짜", "작성일"),
      community: getCommunityField(m.row, "커뮤니티") || getCommunityField(m.row, "게시판"),
      cells: buildCellsFromRow(m.row, sheet.headers),
    })),
  };
}

/** 키워드별 매칭 행을 (시트 단위) 버킷 인용으로 생성. 키워드 -> 부여된 인덱스 목록 */
function buildKeywordCitations(
  matched: MatchedRow[],
  keywords: string[],
  indexBase: number
): { citations: CitationSource[]; keywordIndices: Map<string, number[]> } {
  const citations: CitationSource[] = [];
  const keywordIndices = new Map<string, number[]>();
  let nextIndex = indexBase;

  for (const keyword of keywords) {
    const bySheet = new Map<CommunitySheetData, MatchedRow[]>();
    for (const m of matched) {
      if (!rowMatchesKeyword(m.row, keyword)) continue;
      const arr = bySheet.get(m.sheet) ?? [];
      arr.push(m);
      bySheet.set(m.sheet, arr);
    }

    const indices: number[] = [];
    for (const [sheet, rows] of bySheet) {
      if (rows.length === 0) continue;
      const index = nextIndex++;
      indices.push(index);
      citations.push(buildBucketCitation(index, sheet, rows, `${keyword} 관련 ${rows.length}건`));
    }
    keywordIndices.set(keyword, indices);
  }

  return { citations, keywordIndices };
}

function formatEvidenceTags(indices: number[]): string {
  if (indices.length === 0) return "-";
  return indices.map((i) => `[근거 ${i}]`).join(" ");
}

function rowMatchesLabel(
  row: Record<string, unknown>,
  headers: string[],
  labelFilter: string
): boolean {
  const normalizedFilter = normalizeTextForMatch(labelFilter);
  for (const header of headers) {
    if (!header.startsWith("라벨-")) continue;
    const value = normalizeTextForMatch(getCommunityField(row, header));
    if (value && (value.includes(normalizedFilter) || normalizedFilter.includes(value))) {
      return true;
    }
  }
  return false;
}

function getRowLabels(row: Record<string, unknown>, headers: string[]): string[] {
  const labels: string[] = [];
  for (const header of headers) {
    if (!header.startsWith("라벨-")) continue;
    const value = getCommunityField(row, header);
    if (value) labels.push(`${header.replace(/^라벨-/, "")}:${value}`);
  }
  return labels;
}

function filterRows(sheets: CommunitySheetData[], intent: CommunityQueryIntent): MatchedRow[] {
  const results: MatchedRow[] = [];

  for (const sheet of sheets) {
    sheet.rows.forEach((row, rowIndex) => {
      if (intent.keywords.length > 0) {
        const matchesAny = intent.keywords.some((keyword) => rowMatchesKeyword(row, keyword));
        if (!matchesAny) return;
      }

      if (intent.labelFilter && !rowMatchesLabel(row, sheet.headers, intent.labelFilter)) {
        return;
      }

      if (intent.dateFilter) {
        const date = parseCommunityDate(getCommunityField(row, "게시날짜", "날짜", "작성일"));
        if (date !== intent.dateFilter) return;
      }

      results.push({ sheet, row, rowIndex: rowIndex + 1 });
    });
  }

  return results;
}

function buildDailyCounts(matched: MatchedRow[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const { row } of matched) {
    const date =
      parseCommunityDate(getCommunityField(row, "게시날짜", "날짜", "작성일")) ?? "(날짜 없음)";
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function buildMonthlyCounts(matched: MatchedRow[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const { row } of matched) {
    const date = parseCommunityDate(getCommunityField(row, "게시날짜", "날짜", "작성일"));
    const month = date ? date.slice(0, 7) : "(월 없음)";
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function buildKeywordCounts(
  matched: MatchedRow[],
  keywords: string[]
): Array<[string, number]> {
  if (keywords.length === 0) return [];
  return keywords.map((keyword) => {
    const count = matched.filter(({ row }) => rowMatchesKeyword(row, keyword)).length;
    return [keyword, count] as [string, number];
  });
}

function buildDateKeywordPivot(
  matched: MatchedRow[],
  keywords: string[]
): Array<{ date: string; keyword: string; count: number }> {
  const pivot = new Map<string, number>();
  for (const { row } of matched) {
    const date =
      parseCommunityDate(getCommunityField(row, "게시날짜", "날짜", "작성일")) ?? "(날짜 없음)";
    for (const keyword of keywords) {
      if (!rowMatchesKeyword(row, keyword)) continue;
      const key = `${date}\t${keyword}`;
      pivot.set(key, (pivot.get(key) ?? 0) + 1);
    }
  }

  return [...pivot.entries()]
    .map(([key, count]) => {
      const [date, keyword] = key.split("\t");
      return { date, keyword, count };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || b.count - a.count);
}

function buildBoardKeywordPivot(
  matched: MatchedRow[],
  keywords: string[]
): Array<{ board: string; keyword: string; count: number }> {
  const pivot = new Map<string, number>();
  for (const { row } of matched) {
    const board = getCommunityField(row, "게시판") || "(게시판 없음)";
    for (const keyword of keywords) {
      if (!rowMatchesKeyword(row, keyword)) continue;
      const key = `${board}\t${keyword}`;
      pivot.set(key, (pivot.get(key) ?? 0) + 1);
    }
  }

  return [...pivot.entries()]
    .map(([key, count]) => {
      const [board, keyword] = key.split("\t");
      return { board, keyword, count };
    })
    .sort((a, b) => b.count - a.count);
}

function buildLabelKeywordPivot(
  matched: MatchedRow[],
  keywords: string[]
): Array<{ label: string; keyword: string; count: number }> {
  const pivot = new Map<string, number>();
  for (const { sheet, row } of matched) {
    const labels = getRowLabels(row, sheet.headers);
    const labelKey = labels.length > 0 ? labels.join(", ") : "(라벨 없음)";
    for (const keyword of keywords) {
      if (!rowMatchesKeyword(row, keyword)) continue;
      const key = `${labelKey}\t${keyword}`;
      pivot.set(key, (pivot.get(key) ?? 0) + 1);
    }
  }

  return [...pivot.entries()]
    .map(([key, count]) => {
      const [label, keyword] = key.split("\t");
      return { label, keyword, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
}

export function buildCommunityAggregationReport(
  sheets: CommunitySheetData[],
  intent: CommunityQueryIntent,
  indexBase = 1
): CommunityAggregationReport {
  const totalRowsScanned = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
  const keywords = intent.keywords;

  const parts: string[] = [
    "### 커뮤니티 키워드 집계 (전수 스캔 — 제목·본문 기준)",
    "",
    `- **전체 ${totalRowsScanned.toLocaleString()}행**을 서버에서 스캔했습니다.`,
    "- 매칭 범위: **제목**, **본문** 컬럼만 (키워드 컬럼·댓글 제외)",
    "- 이 섹션은 **RAG 샘플이 아닌 전수 집계**입니다. 건수·차트·비율은 아래 표 숫자만 사용하세요.",
  ];

  if (keywords.length > 0) {
    parts.push(`- 검색 키워드: ${keywords.map((k) => `**${k}**`).join(", ")}`);
  } else {
    parts.push(
      "- 검색 키워드: (질문에서 추출되지 않음)",
      "- **키워드별·교차 집계는 불가**합니다. 특정 인물·주제 건수가 필요하면 질문에 키워드를 명시해 주세요."
    );
  }

  if (intent.labelFilter) {
    parts.push(`- 라벨 필터: **${intent.labelFilter}**`);
  }
  if (intent.dateFilter) {
    parts.push(`- 날짜 필터: **${intent.dateFilter}**`);
  }

  parts.push(
    "",
    "#### 집계 규칙",
    "- 아래 표의 숫자만 건수·차트·비율 답변의 근거로 사용하세요.",
    "- 표에 없는 숫자를 추정·생성하지 마세요.",
    ""
  );

  if (keywords.length === 0) {
    parts.push(
      "#### 집계 결과",
      "",
      `- 전체 게시글: **${totalRowsScanned.toLocaleString()}건**`,
      "- 키워드 미지정 — 키워드별 건수·일별·교차표는 제공하지 않습니다.",
      ""
    );
    return {
      text: parts.join("\n"),
      meta: {
        totalRowsScanned,
        matchedRowCount: totalRowsScanned,
        keywords,
        labelFilter: intent.labelFilter,
        dateFilter: intent.dateFilter,
      },
      citations: [],
    };
  }

  const matched = filterRows(sheets, intent);
  parts[2] = `- **전체 ${totalRowsScanned.toLocaleString()}행** 중 조건에 맞는 **${matched.length.toLocaleString()}건**을 서버에서 집계했습니다.`;

  const { citations, keywordIndices } = buildKeywordCitations(matched, keywords, indexBase);

  if (matched.length === 0) {
    parts.push(
      "#### 집계 결과",
      "",
      "조건에 맞는 게시글이 **0건**입니다. 키워드·날짜·라벨 조건을 확인하세요.",
      ""
    );
  } else {
    parts.push(
      "#### 키워드별 건수",
      "",
      "- **출처** 열의 `[근거 N]` 태그를 해당 키워드 통계를 언급한 문장 끝에 그대로 붙이세요.",
      "",
      "| 키워드 | 건수 | 출처 |",
      "| --- | ---: | --- |"
    );
    for (const [keyword, count] of buildKeywordCounts(matched, keywords)) {
      parts.push(`| ${keyword} | **${count}건** | ${formatEvidenceTags(keywordIndices.get(keyword) ?? [])} |`);
    }
    parts.push("");

    const daily = buildDailyCounts(matched);
    if (daily.length > 0) {
      parts.push("#### 일별 건수", "", "| 날짜 | 건수 |", "| --- | ---: |");
      for (const [date, count] of daily) {
        parts.push(`| ${date} | **${count}건** |`);
      }
      parts.push("");
    }

    const monthly = buildMonthlyCounts(matched);
    if (monthly.length > 1) {
      parts.push("#### 월별 건수", "", "| 월 | 건수 |", "| --- | ---: |");
      for (const [month, count] of monthly) {
        parts.push(`| ${month} | **${count}건** |`);
      }
      parts.push("");
    }

    if (keywords.length > 0 && daily.length > 1) {
      const pivot = buildDateKeywordPivot(matched, keywords);
      if (pivot.length > 0) {
        parts.push("#### 날짜 × 키워드 교차표", "", "| 날짜 | 키워드 | 건수 |", "| --- | --- | ---: |");
        for (const { date, keyword, count } of pivot) {
          parts.push(`| ${date} | ${keyword} | **${count}건** |`);
        }
        parts.push("");
      }
    }

    const boardPivot = buildBoardKeywordPivot(matched, keywords);
    if (boardPivot.length > 0) {
      parts.push("#### 게시판 × 키워드 교차표", "", "| 게시판 | 키워드 | 건수 |", "| --- | --- | ---: |");
      for (const { board, keyword, count } of boardPivot.slice(0, 25)) {
        parts.push(`| ${board} | ${keyword} | **${count}건** |`);
      }
      parts.push("");
    }

    if (!intent.labelFilter) {
      const labelPivot = buildLabelKeywordPivot(matched, keywords);
      if (labelPivot.length > 0) {
        parts.push("#### 라벨 × 키워드 교차표", "", "| 라벨 | 키워드 | 건수 |", "| --- | --- | ---: |");
        for (const { label, keyword, count } of labelPivot) {
          parts.push(`| ${label} | ${keyword} | **${count}건** |`);
        }
        parts.push("");
      }
    }

    parts.push(`#### 총합`, "", `- **${matched.length.toLocaleString()}건**`, "");
  }

  return {
    text: parts.join("\n"),
    meta: {
      totalRowsScanned,
      matchedRowCount: keywords.length > 0 ? matched.length : totalRowsScanned,
      keywords,
      labelFilter: intent.labelFilter,
      dateFilter: intent.dateFilter,
    },
    citations,
  };
}
