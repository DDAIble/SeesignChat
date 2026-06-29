import type { CommunitySheetData } from "./community-analysis";
import type { CitationSource } from "./citations";
import { buildCellsFromRow } from "./chunking";
import {
  getCommunityField,
  getRowTitleBody,
  normalizeTextForMatch,
} from "./community-text-utils";
import type { CommunityRowMatch } from "./community-row-search";

export type PhraseMatchType = "exact" | "similar";

export interface PhraseRowMatch extends CommunityRowMatch {
  phrase: string;
  matchType: PhraseMatchType;
  score: number;
  matchedSnippet: string;
}

export interface PhraseSearchResult {
  matches: PhraseRowMatch[];
  contextText: string;
  citations: CitationSource[];
  phrasesSearched: string[];
}

const SIMILAR_THRESHOLD = 0.25;
const MIN_TOKEN_LENGTH = 2;

const TOKEN_STOP_WORDS = new Set([
  "그리고",
  "하지만",
  "그래서",
  "때문",
  "이런",
  "저런",
  "것이",
  "것을",
  "것은",
  "있는",
  "없는",
  "하는",
  "되는",
  "이다",
  "입니다",
  "있어",
  "없어",
  "같은",
  "정도",
  "많이",
  "너무",
  "매우",
  "에서",
  "으로",
  "에게",
  "까지",
  "부터",
  "처럼",
  "보다",
  "때는",
  "때도",
]);

function tokenizeForOverlap(text: string): string[] {
  const normalized = normalizeTextForMatch(text);
  const tokens = normalized.match(/[가-힣a-z0-9]{2,}/g) ?? [];
  return tokens.filter((t) => t.length >= MIN_TOKEN_LENGTH && !TOKEN_STOP_WORDS.has(t));
}

function longestCommonSubstringLength(a: string, b: string): number {
  if (!a || !b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let maxLen = 0;
  const dp: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
        maxLen = Math.max(maxLen, dp[i][j]);
      }
    }
  }
  return maxLen;
}

export function scorePhraseOverlap(phrase: string, haystack: string): number {
  const normalizedPhrase = normalizeTextForMatch(phrase);
  const normalizedHaystack = normalizeTextForMatch(haystack);
  if (!normalizedPhrase || !normalizedHaystack) return 0;

  if (normalizedHaystack.includes(normalizedPhrase)) return 1;

  const phraseTokens = tokenizeForOverlap(normalizedPhrase);
  if (phraseTokens.length === 0) return 0;

  const haystackTokens = new Set(tokenizeForOverlap(normalizedHaystack));
  const intersection = phraseTokens.filter((t) => haystackTokens.has(t)).length;
  const tokenScore = intersection / phraseTokens.length;

  const lcsLen = longestCommonSubstringLength(normalizedPhrase, normalizedHaystack);
  const lcsScore = lcsLen / Math.max(normalizedPhrase.length, 1);

  return Math.max(tokenScore * 0.7 + lcsScore * 0.3, tokenScore, lcsScore);
}

function extractSnippet(body: string, phrase: string, maxLen = 200): string {
  const normalizedBody = normalizeTextForMatch(body);
  const normalizedPhrase = normalizeTextForMatch(phrase);
  const idx = normalizedBody.indexOf(normalizedPhrase);
  if (idx >= 0) {
    const start = Math.max(0, idx - 40);
    const end = Math.min(body.length, idx + normalizedPhrase.length + 80);
    return body.slice(start, end).trim();
  }

  const phraseTokens = tokenizeForOverlap(phrase);
  for (const token of phraseTokens.sort((a, b) => b.length - a.length)) {
    const tokenIdx = normalizedBody.indexOf(token);
    if (tokenIdx >= 0) {
      const start = Math.max(0, tokenIdx - 40);
      const end = Math.min(body.length, tokenIdx + token.length + 120);
      return body.slice(start, end).trim();
    }
  }

  return body.slice(0, maxLen).trim();
}

function rowKey(match: PhraseRowMatch): string {
  return `${match.fileName}|${match.sheetName}|${match.rowIndex}|${match.phrase}`;
}

export function searchCommunityRowsByPhrases(
  sheets: CommunitySheetData[],
  phrases: string[],
  limit = 15
): PhraseSearchResult {
  const effectivePhrases = phrases.filter((p) => p.trim().length >= 15);
  const allMatches: PhraseRowMatch[] = [];

  for (const phrase of effectivePhrases) {
    for (const sheet of sheets) {
      for (let i = 0; i < sheet.rows.length; i++) {
        const row = sheet.rows[i];
        const { title, body } = getRowTitleBody(row);
        const haystack = `${title}\n${body}`;
        const normalizedHaystack = normalizeTextForMatch(haystack);
        const normalizedPhrase = normalizeTextForMatch(phrase);

        const isExact =
          normalizedPhrase.length > 0 && normalizedHaystack.includes(normalizedPhrase);
        const score = isExact ? 1 : scorePhraseOverlap(phrase, haystack);

        if (isExact || score >= SIMILAR_THRESHOLD) {
          allMatches.push({
            rowIndex: i + 1,
            fileName: sheet.fileName,
            sheetName: sheet.sheetName,
            date: getCommunityField(row, "게시날짜", "날짜", "작성일"),
            community: getCommunityField(row, "커뮤니티"),
            board: getCommunityField(row, "게시판"),
            title,
            body,
            headers: sheet.headers,
            cells: buildCellsFromRow(row, sheet.headers),
            phrase,
            matchType: isExact ? "exact" : "similar",
            score,
            matchedSnippet: extractSnippet(body || title, phrase),
          });
        }
      }
    }
  }

  allMatches.sort((a, b) => {
    if (a.matchType !== b.matchType) return a.matchType === "exact" ? -1 : 1;
    return b.score - a.score;
  });

  const seen = new Set<string>();
  const deduped: PhraseRowMatch[] = [];
  for (const match of allMatches) {
    const key = rowKey(match);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(match);
    if (deduped.length >= limit) break;
  }

  const contextText = formatPhraseSearchContext(deduped, effectivePhrases);
  const citations = buildCitationsFromPhraseMatches(deduped);

  return {
    matches: deduped,
    contextText,
    citations,
    phrasesSearched: effectivePhrases,
  };
}

function formatPhraseSearchContext(
  matches: PhraseRowMatch[],
  phrases: string[]
): string {
  if (phrases.length === 0) {
    return [
      "### 출처 추적 검색 (검색 구절 없음)",
      "",
      "검색할 구절을 찾지 못했습니다. 원문 또는 AI 요약 문장을 붙여넣어 주세요.",
    ].join("\n");
  }

  if (matches.length === 0) {
    return [
      "### 출처 추적 검색 (검색 결과 0건)",
      "",
      `- 검색 구절 ${phrases.length}개에 대해 **제목·본문 전수 스캔** 결과 일치·유사 게시글이 없습니다.`,
      "- 해당 문장은 **AI가 여러 게시글을 요약·합성한 paraphrase**일 수 있습니다.",
      "- 동일 원문이 없음을 사용자에게 명확히 알리세요.",
      "",
      "**검색 구절:**",
      ...phrases.map((p) => `- ${p.slice(0, 120)}${p.length > 120 ? "…" : ""}`),
    ].join("\n");
  }

  const exactCount = matches.filter((m) => m.matchType === "exact").length;
  const similarCount = matches.length - exactCount;

  const parts = [
    "### 출처 추적 검색 (제목·본문 전수 스캔)",
    "",
    `- 검색 구절 ${phrases.length}개 → **${matches.length}건** (정확 ${exactCount} · 유사 ${similarCount})`,
    "- **exact**: 사용자 구절이 제목·본문에 그대로 포함",
    "- **similar**: 토큰·부분문자열 유사도로 매칭 — AI 요약과 가장 가까운 원문 후보",
    "",
    "**검색 구절:**",
    ...phrases.map((p) => `- ${p.slice(0, 120)}${p.length > 120 ? "…" : ""}`),
    "",
  ];

  matches.forEach((match, index) => {
    const meta = [match.date, match.community, match.board].filter(Boolean).join(" | ");
    parts.push(
      `#### [${index + 1}] ${match.matchType.toUpperCase()} · ${match.fileName} / ${match.sheetName} / 행 ${match.rowIndex}${meta ? ` (${meta})` : ""}`,
      `- 유사도: ${(match.score * 100).toFixed(0)}% · 검색 구절: ${match.phrase.slice(0, 60)}${match.phrase.length > 60 ? "…" : ""}`,
      "",
      `**제목**: ${match.title || "(제목 없음)"}`,
      "",
      "**매칭 발췌**:",
      match.matchedSnippet || "(발췌 없음)",
      "",
      "**본문 전체**:",
      match.body || "(본문 없음)",
      ""
    );
  });

  return parts.join("\n");
}

function buildCitationsFromPhraseMatches(matches: PhraseRowMatch[]): CitationSource[] {
  return matches.map((match, index) => ({
    index: index + 1,
    fileName: match.fileName,
    sheetName: match.sheetName,
    rowIndex: match.rowIndex,
    rowEnd: match.rowIndex,
    title: match.title || "(제목 없음)",
    body: match.body,
    headers: match.headers,
    rows: [
      {
        rowIndex: match.rowIndex,
        title: match.title || "-",
        body: match.body,
        date: match.date,
        community: match.community || match.board,
        cells: match.cells,
      },
    ],
  }));
}
