import type { CommunitySheetData } from "./community-analysis";
import type { CitationSource } from "./citations";
import {
  getCommunityField,
  parseCommunityDate,
  rowMatchesKeyword,
  normalizeTextForMatch,
} from "./community-text-utils";
import type { CommunityQueryIntent } from "./community-query-intent";

export interface CommunityRowMatch {
  rowIndex: number;
  fileName: string;
  sheetName: string;
  date: string;
  community: string;
  board: string;
  title: string;
  body: string;
}

export interface CommunityRowSearchResult {
  rows: CommunityRowMatch[];
  contextText: string;
  citations: CitationSource[];
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

export function searchCommunityRows(
  sheets: CommunitySheetData[],
  intent: CommunityQueryIntent
): CommunityRowSearchResult {
  const limit = intent.limit ?? 20;
  const matches: CommunityRowMatch[] = [];

  outer: for (const sheet of sheets) {
    for (let i = 0; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];

      if (intent.keywords.length > 0) {
        const matchesAny = intent.keywords.some((keyword) => rowMatchesKeyword(row, keyword));
        if (!matchesAny) continue;
      }

      if (intent.labelFilter && !rowMatchesLabel(row, sheet.headers, intent.labelFilter)) {
        continue;
      }

      if (intent.dateFilter) {
        const date = parseCommunityDate(getCommunityField(row, "게시날짜", "날짜", "작성일"));
        if (date !== intent.dateFilter) continue;
      }

      matches.push({
        rowIndex: i + 1,
        fileName: sheet.fileName,
        sheetName: sheet.sheetName,
        date: getCommunityField(row, "게시날짜", "날짜", "작성일"),
        community: getCommunityField(row, "커뮤니티"),
        board: getCommunityField(row, "게시판"),
        title: getCommunityField(row, "제목"),
        body: getCommunityField(row, "본문"),
      });

      if (matches.length >= limit) break outer;
    }
  }

  const contextText = formatQuoteContext(matches, intent);
  const citations = buildCitationsFromRows(matches);

  return { rows: matches, contextText, citations };
}

function formatQuoteContext(matches: CommunityRowMatch[], intent: CommunityQueryIntent): string {
  if (matches.length === 0) {
    return [
      "### 인용 가능 원문 (검색 결과 0건)",
      "",
      "조건에 맞는 게시글을 찾지 못했습니다. 키워드·날짜·라벨 조건을 확인하세요.",
      "- 인용할 원문이 없으면 임의 문장을 생성하지 마세요.",
    ].join("\n");
  }

  const parts = [
    "### 인용 가능 원문 (검색 결과 — 제목·본문 기준)",
    "",
    `- **${matches.length}건**의 게시글을 서버에서 검색했습니다.`,
    "- 아래 **제목·본문**만 인용 가능합니다. 글자 그대로 복사하세요.",
    "- 아래 목록에 없는 문장은 절대 생성·요약·의역하지 마세요.",
  ];

  if (intent.keywords.length > 0) {
    parts.push(`- 검색 키워드: ${intent.keywords.map((k) => `**${k}**`).join(", ")}`);
  }
  if (intent.labelFilter) {
    parts.push(`- 라벨 필터: **${intent.labelFilter}**`);
  }
  if (intent.dateFilter) {
    parts.push(`- 날짜 필터: **${intent.dateFilter}**`);
  }

  parts.push("");

  matches.forEach((match, index) => {
    const meta = [match.date, match.community, match.board].filter(Boolean).join(" | ");
    parts.push(
      `#### [${index + 1}] ${match.fileName} / ${match.sheetName} / 행 ${match.rowIndex}${meta ? ` (${meta})` : ""}`,
      "",
      `**제목**: ${match.title || "(제목 없음)"}`,
      "",
      "**본문**:",
      match.body || "(본문 없음)",
      ""
    );
  });

  return parts.join("\n");
}

function buildCitationsFromRows(matches: CommunityRowMatch[]): CitationSource[] {
  return matches.map((match, index) => ({
    index: index + 1,
    fileName: match.fileName,
    sheetName: match.sheetName,
    rowIndex: match.rowIndex,
    rowEnd: match.rowIndex,
    title: match.title || "(제목 없음)",
    body: match.body,
    rows: [
      {
        rowIndex: match.rowIndex,
        title: match.title || "-",
        body: match.body,
        date: match.date,
        community: match.community || match.board,
      },
    ],
  }));
}

export function buildCommunityCorpus(sheets: CommunitySheetData[]): string[] {
  const corpus: string[] = [];
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const title = getCommunityField(row, "제목");
      const body = getCommunityField(row, "본문");
      if (title) corpus.push(title);
      if (body) corpus.push(body);
      if (title && body) corpus.push(`${title}\n${body}`);
    }
  }
  return corpus;
}
