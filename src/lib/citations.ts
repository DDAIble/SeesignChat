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

/** 본문(게시글 텍스트)이 있는 출처만 — 통계·집계 전용 인용 제외 */
export function isBodyContentCitation(source: CitationSource): boolean {
  if ((source.body?.trim() ?? "").length >= 10) return true;
  return source.rows.some((row) => (row.body?.trim() ?? "").length >= 10);
}

export function filterBodyContentCitations(
  sources: CitationSource[] | null | undefined
): CitationSource[] {
  return (sources ?? []).filter(isBodyContentCitation);
}

export interface EvidenceRef {
  fileName: string;
  sheetName: string;
  rowStart: number;
  rowEnd: number;
}

/** `(근거: 파일 / 시트 / 행 N~M)` 텍스트 파싱 */
export function parseEvidenceRef(text: string): EvidenceRef | null {
  const normalized = text.trim().replace(/\s+/g, " ");
  const match = normalized.match(
    /^(.+?)\s*\/\s*(.+?)\s*\/\s*행\s*(\d+)(?:\s*[~\-–]\s*(\d+))?$/
  );
  if (!match) return null;
  const rowStart = Number(match[3]);
  const rowEnd = match[4] ? Number(match[4]) : rowStart;
  if (!Number.isFinite(rowStart)) return null;
  return {
    fileName: match[1].trim(),
    sheetName: match[2].trim(),
    rowStart,
    rowEnd: Number.isFinite(rowEnd) ? rowEnd : rowStart,
  };
}

function fileNamesMatch(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  return na === nb || na.endsWith(nb) || nb.endsWith(na);
}

/** 파일·시트·행으로 citation index 매칭 */
export function findCitationIndexForRef(
  citations: CitationSource[],
  ref: EvidenceRef
): number | null {
  for (const citation of citations) {
    if (!fileNamesMatch(citation.fileName, ref.fileName)) continue;
    if (
      citation.sheetName !== ref.sheetName &&
      !citation.sheetName.includes(ref.sheetName) &&
      !ref.sheetName.includes(citation.sheetName)
    ) {
      continue;
    }
    const rowInRange =
      ref.rowStart >= citation.rowIndex && ref.rowStart <= citation.rowEnd;
    const exactRow = citation.rowIndex === ref.rowStart;
    if (rowInRange || exactRow) return citation.index;
  }
  return null;
}

/**
 * `[근거 N]` 및 레거시 `(근거: 파일/시트/행)` → 클릭 가능한 `[근거 N](cite:N)` 링크로 변환
 */
export function preprocessEvidenceLinks(
  content: string,
  citations: CitationSource[]
): string {
  const bodyCitations = filterBodyContentCitations(citations);
  let result = content;

  result = result.replace(/\[근거\s+(\d{1,3})\]/g, "[근거 $1](cite:$1)");

  result = result.replace(/\(근거\s*:\s*([^)]+)\)/g, (_match, inner: string) => {
    const parts = inner.split(/\s*,\s*/).map((p) => p.trim()).filter(Boolean);
    const links: string[] = [];
    for (const part of parts) {
      const ref = parseEvidenceRef(part);
      if (!ref) continue;
      const index = findCitationIndexForRef(bodyCitations, ref);
      if (index !== null) links.push(`[근거 ${index}](cite:${index})`);
    }
    return links.length > 0 ? links.join(" ") : "";
  });

  return result.replace(/\n{3,}/g, "\n\n").trim();
}

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
