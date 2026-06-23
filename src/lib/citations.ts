export interface CitationRowData {
  rowIndex: number;
  title: string;
  body: string;
  date: string;
  community: string;
}

export interface CitationSource {
  index: number;
  fileName: string;
  sheetName: string;
  rowIndex: number;
  rowEnd: number;
  title: string;
  body: string;
  rows: CitationRowData[];
}

export interface CitationData {
  sources: CitationSource[];
}

export function isCitationData(value: unknown): value is CitationData {
  if (!value || typeof value !== "object") return false;
  const data = value as CitationData;
  return Array.isArray(data.sources);
}

export function citationsByIndex(sources: CitationSource[] | null | undefined): Map<number, CitationSource> {
  const list = sources ?? [];
  return new Map(list.map((source) => [source.index, source]));
}

/** 답변 본문에서 [N] 형태 인용 번호를 추출합니다. */
export function extractCitationIndices(content: string): Set<number> {
  const indices = new Set<number>();
  for (const match of content.matchAll(/\[(\d{1,3})\]/g)) {
    const index = Number(match[1]);
    if (Number.isFinite(index) && index > 0) indices.add(index);
  }
  return indices;
}

/** 답변에 실제로 등장한 인용 번호에 해당하는 출처만 남깁니다. */
export function filterCitationsUsedInText(
  content: string,
  sources: CitationSource[] | null | undefined
): CitationSource[] {
  const indices = extractCitationIndices(content);
  if (indices.size === 0) return [];
  return (sources ?? []).filter((source) => indices.has(source.index));
}

/** 화면에 표시할 출처: 답변에 [N] 표기가 있으면 해당 건만, 없으면 RAG 검색 전체 */
export function resolveDisplayedCitations(
  content: string,
  sources: CitationSource[] | null | undefined
): CitationSource[] {
  const list = sources ?? [];
  if (list.length === 0) return [];
  const used = filterCitationsUsedInText(content, list);
  return used.length > 0 ? used : list;
}

/** 답변 본문에서 [N] 인용 표기를 제거합니다 (화면 표시용). */
export function stripCitationMarkers(content: string): string {
  return content
    .replace(/^\s*인용\s*:\s*(\[\d{1,3}\](?:\s*,\s*\[\d{1,3}\])*)\s*$/gm, "")
    .replace(/\s*\[(\d{1,3})\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
