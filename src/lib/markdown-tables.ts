export interface RankRow {
  rank: string;
  location: string;
  count: string;
}

const RANK_MARKER_RE = /(?:^|\s)-(?:(공동)\s+)?(\d+)위:\s*/g;
const SINGLE_RANK_LINE_RE =
  /^\s*-(?:(공동)\s+)?(\d+)위:\s*(.+?)(?:\s*\((\d+)건\))?\s*$/;

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

export function parseSingleRankLine(line: string): RankRow | null {
  const match = line.trim().match(SINGLE_RANK_LINE_RE);
  if (!match) return null;

  const rank = match[1] ? `공동 ${match[2]}위` : `${match[2]}위`;
  const location = match[3].trim();
  const count = match[4] ? `${match[4]}건` : "";

  return { rank, location, count };
}

export function extractRankRowsFromText(text: string): RankRow[] | null {
  const markers = [...text.matchAll(RANK_MARKER_RE)];
  if (markers.length < 2) return null;

  const rows: RankRow[] = [];

  for (let i = 0; i < markers.length; i += 1) {
    const marker = markers[i];
    const rank = marker[1] ? `공동 ${marker[2]}위` : `${marker[2]}위`;
    const contentStart = marker.index! + marker[0].length;
    const contentEnd =
      i + 1 < markers.length ? markers[i + 1].index! : text.length;
    const content = text.slice(contentStart, contentEnd).trim();
    const countMatch = content.match(/\((\d+)건\)\s*$/);
    const count = countMatch ? `${countMatch[1]}건` : "";
    const location = countMatch
      ? content.slice(0, countMatch.index).trim()
      : content;

    rows.push({ rank, location, count });
  }

  return rows.length >= 2 ? rows : null;
}

export function rankRowsToMarkdownTable(
  rows: RankRow[],
  headers: [string, string, string] = ["순위", "교재·페이지·문항", "질문 수"]
): string {
  const lines = [
    `| ${headers[0]} | ${headers[1]} | ${headers[2]} |`,
    "| --- | --- | ---: |",
    ...rows.map(
      (row) =>
        `| ${escapeTableCell(row.rank)} | ${escapeTableCell(row.location)} | ${escapeTableCell(row.count)} |`
    ),
  ];
  return lines.join("\n");
}

function normalizeInlineRankings(line: string): string {
  const rows = extractRankRowsFromText(line);
  if (!rows) return line;
  return rankRowsToMarkdownTable(rows);
}

function normalizeMultilineRankLists(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (buffer.length >= 2) {
      const rows = buffer
        .map((line) => parseSingleRankLine(line))
        .filter((row): row is RankRow => row !== null);

      if (rows.length >= 2) {
        result.push(rankRowsToMarkdownTable(rows));
      } else {
        result.push(...buffer);
      }
    } else {
      result.push(...buffer);
    }
    buffer = [];
  };

  for (const line of lines) {
    if (SINGLE_RANK_LINE_RE.test(line.trim())) {
      buffer.push(line);
    } else {
      flushBuffer();
      result.push(line);
    }
  }

  flushBuffer();
  return result.join("\n");
}

/** 한 줄에 붙은 GFM 표 행을 줄바꿈으로 분리합니다. */
function normalizeCollapsedMarkdownTables(text: string): string {
  let result = text;

  result = result.replace(
    /(\|[^\n]+?\|)\s+(\|\s*[-:]+)/g,
    "$1\n$2"
  );

  result = result.replace(
    /(\|\s*[-:]+\s*(?:\|\s*[-:]+\s*)*\|)\s+(\|)/g,
    "$1\n$2"
  );

  result = result.replace(
    /(\|[^\n]+?\|)\s+(\|(?!\s*[-:]))/g,
    "$1\n$2"
  );

  return result;
}

/** 이모지 제목(📚 ...)을 마크다운 헤딩으로 정리합니다. */
function normalizeEmojiHeadings(text: string): string {
  return text.replace(
    /^(#{1,6}\s*)?([📚🎬📊💡🔥✅⚠️]\s*.+)$/gm,
    (_, hashes, title) => {
      if (hashes) return `${hashes}${title}`;
      return `### ${title}`;
    }
  );
}

export function normalizeMarkdownTables(text: string): string {
  let result = normalizeEmojiHeadings(text);
  result = normalizeCollapsedMarkdownTables(result);

  result = result
    .split("\n")
    .map((line) => {
      if (line.includes("|") && line.includes("---")) return line;
      if (extractRankRowsFromText(line)) return normalizeInlineRankings(line);
      return line;
    })
    .join("\n");

  result = normalizeMultilineRankLists(result);
  return result;
}
