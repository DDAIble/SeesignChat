export interface CitationRowData {
  rowIndex: number;
  title: string;
  body: string;
  date: string;
  community: string;
  /** 원본 엑셀 컬럼명 -> 셀 값 (모달에서 원본 컬럼 그대로 표시) */
  cells?: Record<string, string>;
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
  /** 원본 엑셀 헤더(컬럼 순서). 통계/원본컬럼 모달 표시에 사용 */
  headers?: string[];
}

export interface CitationData {
  sources: CitationSource[];
}

export interface EvidenceSegmentRef {
  citationIndex: number;
  /** 빈 배열이면 해당 인용(버킷)의 전체 행을 의미 */
  rowNumbers: number[];
}

export interface EvidenceLinkTarget {
  segments: EvidenceSegmentRef[];
}

export interface EvidenceDisplaySegment {
  fileName: string;
  sheetName: string;
  rows: CitationRowData[];
  /** 원본 컬럼 순서 (없으면 모달이 레거시 5열로 폴백) */
  headers?: string[];
}

function rowHasContent(row: CitationRowData): boolean {
  if ((row.body?.trim() ?? "").length > 0) return true;
  if ((row.title?.trim() ?? "").length > 0) return true;
  if (row.cells) {
    for (const value of Object.values(row.cells)) {
      if (String(value ?? "").trim().length > 0) return true;
    }
  }
  return false;
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

export function getCitationByIndex(
  citations: CitationSource[],
  index: number
): CitationSource | undefined {
  return citations.find((source) => source.index === index);
}

/** href 본문의 공백·구분자 정규화 (모델이 2:4380 | 11:4221 처럼 쓰는 경우) */
export function normalizeEvidenceHrefPart(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/\|+/g, "|").replace(/,+/g, ",");
}

/** #evidence-2:52,58|3:71 또는 행 없는 버킷 인용 #evidence-7 파싱 */
export function parseEvidenceHref(href: string): EvidenceLinkTarget | null {
  const hash = href.startsWith("#") ? href.slice(1) : href;
  if (!hash.startsWith("evidence-")) return null;

  const evidenceBody = normalizeEvidenceHrefPart(hash.replace(/^evidence-/, ""));
  if (!evidenceBody) return null;

  const segments: EvidenceSegmentRef[] = [];
  for (const part of evidenceBody.split("|")) {
    const segmentMatch = /^(\d{1,3})(?::([\d,]+))?$/.exec(part.trim());
    if (!segmentMatch) continue;
    const citationIndex = Number(segmentMatch[1]);
    if (!Number.isFinite(citationIndex) || citationIndex <= 0) continue;
    const rowNumbers = (segmentMatch[2] ?? "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);
    segments.push({ citationIndex, rowNumbers });
  }

  return segments.length > 0 ? { segments } : null;
}

export function buildEvidenceHref(segments: EvidenceSegmentRef[]): string {
  const parts = segments.map((segment) => {
    const rows = [...new Set(segment.rowNumbers)].sort((a, b) => a - b);
    return rows.length > 0 ? `${segment.citationIndex}:${rows.join(",")}` : `${segment.citationIndex}`;
  });
  return `#evidence-${parts.join("|")}`;
}

export function filterCitationRows(
  source: CitationSource,
  rowNumbers: number[]
): CitationRowData[] {
  const wanted = new Set(rowNumbers);
  const fromRows = source.rows.filter(
    (row) => wanted.has(row.rowIndex) && rowHasContent(row)
  );
  if (fromRows.length > 0) return fromRows;

  if (rowNumbers.length === 1 && source.rowIndex === rowNumbers[0]) {
    return [
      {
        rowIndex: source.rowIndex,
        title: source.title,
        body: source.body,
        date: "",
        community: "",
      },
    ];
  }
  return [];
}

/** 행 미지정(버킷) 인용 — source의 전체 행 반환 */
function allCitationRows(source: CitationSource): CitationRowData[] {
  const rows = source.rows.filter(rowHasContent);
  if (rows.length > 0) return rows;
  if ((source.body?.trim() ?? "").length > 0 || (source.title?.trim() ?? "").length > 0) {
    return [
      {
        rowIndex: source.rowIndex,
        title: source.title,
        body: source.body,
        date: "",
        community: "",
      },
    ];
  }
  return [];
}

function mergeRowsIntoGroup(
  grouped: Map<string, EvidenceDisplaySegment>,
  source: CitationSource,
  rows: CitationRowData[]
): void {
  if (rows.length === 0) return;
  const key = `${source.fileName}\0${source.sheetName}`;
  const existing = grouped.get(key);
  if (existing) {
    if ((existing.headers?.length ?? 0) === 0 && (source.headers?.length ?? 0) > 0) {
      existing.headers = source.headers;
    }
    const seen = new Set(existing.rows.map((row) => row.rowIndex));
    for (const row of rows) {
      if (!seen.has(row.rowIndex)) existing.rows.push(row);
    }
    existing.rows.sort((a, b) => a.rowIndex - b.rowIndex);
  } else {
    grouped.set(key, {
      fileName: source.fileName,
      sheetName: source.sheetName,
      rows: [...rows].sort((a, b) => a.rowIndex - b.rowIndex),
      headers: source.headers,
    });
  }
}

function findRowsInSource(source: CitationSource, rowNumbers: number[]): CitationRowData[] {
  const found: CitationRowData[] = [];
  const seen = new Set<number>();
  for (const row of rowNumbers) {
    if (seen.has(row)) continue;
    const rows = filterCitationRows(source, [row]);
    if (rows.length > 0) {
      found.push(...rows);
      seen.add(row);
    }
  }
  return found;
}

/** 링크 타겟 → 파일·시트별 표시 segment (모달용) */
export function resolveEvidenceDisplaySegments(
  target: EvidenceLinkTarget,
  citations: CitationSource[]
): EvidenceDisplaySegment[] {
  const bodyCitations = filterBodyContentCitations(citations);
  const grouped = new Map<string, EvidenceDisplaySegment>();
  const unresolvedRows = new Set<number>();

  for (const ref of target.segments) {
    const source = getCitationByIndex(bodyCitations, ref.citationIndex);
    if (!source) {
      for (const row of ref.rowNumbers) unresolvedRows.add(row);
      continue;
    }

    if (ref.rowNumbers.length === 0) {
      mergeRowsIntoGroup(grouped, source, allCitationRows(source));
      continue;
    }

    const validRows = ref.rowNumbers.filter(
      (row) =>
        row >= source.rowIndex &&
        row <= source.rowEnd &&
        filterCitationRows(source, [row]).length > 0
    );
    if (validRows.length > 0) {
      mergeRowsIntoGroup(grouped, source, filterCitationRows(source, validRows));
    }

    for (const row of ref.rowNumbers) {
      if (!validRows.includes(row)) unresolvedRows.add(row);
    }
  }

  if (unresolvedRows.size > 0) {
    for (const row of unresolvedRows) {
      for (const source of bodyCitations) {
        const rows = findRowsInSource(source, [row]);
        if (rows.length > 0) {
          mergeRowsIntoGroup(grouped, source, rows);
          break;
        }
      }
    }
  }

  return [...grouped.values()];
}

export function countEvidenceRows(segments: EvidenceDisplaySegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.rows.length, 0);
}

export function countEvidenceRowRefs(segments: EvidenceSegmentRef[]): number {
  const rows = new Set<number>();
  for (const ref of segments) {
    for (const row of ref.rowNumbers) rows.add(row);
  }
  return rows.size;
}

/** 클릭 링크 라벨 — citations 미로드 시 href 기준 건수 */
export function formatEvidenceLinkLabelFromRefs(segments: EvidenceSegmentRef[]): string {
  const count = countEvidenceRowRefs(segments);
  return count > 0 ? `출처 ${count}건` : "출처";
}

/** 클릭 링크 라벨 */
export function formatEvidenceLinkLabel(
  displaySegments: EvidenceDisplaySegment[]
): string {
  const rowCount = countEvidenceRows(displaySegments);
  return rowCount > 0 ? `출처 ${rowCount}건` : "출처";
}

export function extractEvidenceIndices(content: string): Set<number> {
  const indices = new Set<number>();
  for (const match of content.matchAll(/\[근거\s*(\d{1,3})\s*(?:[:：]|\])/gi)) {
    const index = Number(match[1]);
    if (Number.isFinite(index) && index > 0) indices.add(index);
  }
  for (const match of content.matchAll(/#evidence-([\d:,|]+)/gi)) {
    for (const part of match[1].split("|")) {
      const segmentMatch = /^(\d{1,3})/.exec(part);
      if (segmentMatch) indices.add(Number(segmentMatch[1]));
    }
  }
  return indices;
}

export function isBodyContentCitation(source: CitationSource): boolean {
  if ((source.body?.trim() ?? "").length >= 10) return true;
  if (source.rows.some((row) => (row.body?.trim() ?? "").length >= 10)) return true;
  return source.rows.some(
    (row) => row.cells && Object.values(row.cells).some((v) => String(v ?? "").trim().length > 0)
  );
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

function parseRowNumbers(raw: string): number[] {
  return raw
    .split(/[,，、]/)
    .map((part) => Number(part.replace(/[^\d]/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0);
}

/** `[근거 2:52,58]` / `[근거 2:52;3:71]` / 행 없는 `[근거 7]` 파싱 */
function parseEvidenceTag(inner: string): EvidenceSegmentRef[] {
  const segments: EvidenceSegmentRef[] = [];
  for (const part of inner.split(";")) {
    const match = /^\s*(\d{1,3})\s*(?:[:：]\s*(.+))?$/.exec(part.trim());
    if (!match) continue;
    const citationIndex = Number(match[1]);
    if (!Number.isFinite(citationIndex) || citationIndex <= 0) continue;
    const rowNumbers = match[2] ? parseRowNumbers(match[2]) : [];
    segments.push({ citationIndex, rowNumbers });
  }
  return segments;
}

function mergeSegmentRefs(all: EvidenceSegmentRef[]): EvidenceSegmentRef[] {
  const map = new Map<number, { rows: Set<number>; all: boolean }>();
  for (const ref of all) {
    const entry = map.get(ref.citationIndex) ?? { rows: new Set<number>(), all: false };
    if (ref.rowNumbers.length === 0) {
      entry.all = true;
    } else {
      for (const row of ref.rowNumbers) entry.rows.add(row);
    }
    map.set(ref.citationIndex, entry);
  }
  return [...map.entries()]
    .map(([citationIndex, entry]) => ({
      citationIndex,
      rowNumbers: entry.all ? [] : [...entry.rows].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.citationIndex - b.citationIndex);
}

function buildLinkFromSegments(
  segments: EvidenceSegmentRef[],
  citations: CitationSource[]
): string {
  const merged = mergeSegmentRefs(segments);
  if (merged.length === 0) return "";

  const href = buildEvidenceHref(merged);
  const display =
    citations.length > 0
      ? resolveEvidenceDisplaySegments({ segments: merged }, citations)
      : [];
  const label =
    display.length > 0
      ? formatEvidenceLinkLabel(display)
      : formatEvidenceLinkLabelFromRefs(merged);
  return `[${label}](${href})`;
}

function normalizeExistingEvidenceLinks(
  content: string,
  citations: CitationSource[]
): string {
  return content.replace(
    /\[([^\]]+)\]\(#evidence-([^)]+)\)/gi,
    (_match, _text, evidencePart) => {
      const normalized = normalizeEvidenceHrefPart(evidencePart);
      const target = parseEvidenceHref(`#evidence-${normalized}`);
      if (!target) return _match;
      return buildLinkFromSegments(target.segments, citations);
    }
  );
}

/** 답변 본문에서 (AI 요약) 라벨 제거 — 출처 버튼만 표시 */
export function stripAiSummaryLabels(content: string): string {
  return content.replace(/\s*\(AI\s*요약\)\s*/gi, " ");
}

export function stripChunkEvidenceText(content: string): string {
  return content
    .replace(/\s*[\w\-./]+\.(?:xlsx|xls|csv)\s*·\s*\d+(?:~\d+)?행/gi, "")
    .replace(/\s*[\w\-./]+\s*·\s*\d+(?:~\d+)?행/gi, "")
    .replace(/\s*\[(\d{1,3})행\](?!\()/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 연속된 `[근거 ...]` 태그를 **하나의** 클릭 링크로 병합
 * `[근거 2:52,58]` / `[근거 2:52;3:71]` / `[근거 2:52] [근거 2:58]` 지원
 */
export function preprocessEvidenceLinks(
  content: string,
  citations: CitationSource[]
): string {
  let result = stripAiSummaryLabels(content);
  result = normalizeExistingEvidenceLinks(result, citations);

  result = result.replace(
    /(?:\[근거\s*([^\]]+)\]\s*)+/gi,
    (group) => {
      const tags = [...group.matchAll(/\[근거\s*([^\]]+)\]/gi)];
      const allSegments: EvidenceSegmentRef[] = [];
      for (const tag of tags) {
        if (tag[1]) allSegments.push(...parseEvidenceTag(tag[1]));
      }
      return allSegments.length > 0 ? ` ${buildLinkFromSegments(allSegments, citations)}` : "";
    }
  );

  // 안전망: 마크다운 링크가 아닌 맨몸 #evidence-... (또는 (#evidence-...)) 평문 처리.
  // 정상 링크 `[..](#evidence-..)`는 `(` 앞 문자가 `]`이므로 건너뜀.
  result = result.replace(
    /(\()?#evidence-([^)\s]+(?:\s*\|\s*[^)\s]+)*)(\))?/g,
    (match, leftParen, evidencePart, _rightParen, offset: number, full: string) => {
      const charBefore = offset > 0 ? full[offset - 1] : "";
      if (leftParen === "(" && charBefore === "]") return match;
      const normalized = normalizeEvidenceHrefPart(evidencePart);
      const target = parseEvidenceHref(`#evidence-${normalized}`);
      if (!target) return match;
      return buildLinkFromSegments(target.segments, citations);
    }
  );

  result = result.replace(/\(근거\s*:\s*[^)]+\)/g, "");
  result = stripChunkEvidenceText(result);

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

export function filterCitationsUsedInText(
  content: string,
  sources: CitationSource[] | null | undefined
): CitationSource[] {
  const evidenceIndices = extractEvidenceIndices(content);
  if (evidenceIndices.size > 0) {
    return (sources ?? []).filter((source) => evidenceIndices.has(source.index));
  }
  const indices = extractCitationIndices(content);
  if (indices.size === 0) return [];
  return (sources ?? []).filter((source) => indices.has(source.index));
}

export function resolveDisplayedCitations(
  content: string,
  sources: CitationSource[] | null | undefined
): CitationSource[] {
  const list = filterBodyContentCitations(sources);
  if (list.length === 0) return [];
  const used = filterCitationsUsedInText(content, list);
  return used.length > 0 ? used : list;
}

export function stripCitationMarkers(content: string): string {
  return content
    .replace(/^\s*인용\s*:\s*(\[\d{1,3}\](?:\s*,\s*\[\d{1,3}\])*)\s*$/gm, "")
    .replace(/\s*\[(\d{1,3})\](?!\()/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
