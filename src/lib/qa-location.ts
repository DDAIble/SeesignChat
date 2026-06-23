export interface ParsedTextbookLocation {
  raw: string;
  bookName: string | null;
  bookFamily: string | null;
  bookSeriesKey: string | null;
  page: number | null;
  questionNumber: number | null;
  questionLabel: string | null;
  matchKey: string | null;
  sourceColumn: string;
}

export interface ParsedLectureLocation {
  raw: string;
  session: string | null;
  day: string | null;
  title: string | null;
  videoTimestamp: string | null;
  matchKey: string | null;
  sourceColumn: string;
}

export interface RowLocationAnalysis {
  textbook: ParsedTextbookLocation[];
  lecture: ParsedLectureLocation[];
  primaryTextbookKey: string | null;
  primaryLectureKey: string | null;
}

export interface QALocationColumns {
  textbookColumns: string[];
  lectureColumns: string[];
}

const TEXTBOOK_PAGE_PATTERN = /페이지\s*수\s*[:：]\s*(\d+)/i;
const TEXTBOOK_QUESTION_PATTERN = /문제\s*번호\s*[:：]\s*(미\s*기입|\d+)/i;

const LECTURE_SESSION_PREFIX = /^(\d+차시)\s*\/\s*/;
const LECTURE_VIDEO_PATTERN = /동영상\s*위치\s*:?\s*(\d{1,2}:\d{2}(?::\d{2})?)/i;
const LECTURE_DAY_PATTERN = /^Day\s*(\d+)(?:\.|\s)\s*(.*)$/i;

/** 신규: 질문 대상 (교재 위치) / 레거시(qnas 3): 세부교재 */
const TEXTBOOK_COLUMN_PATTERNS = [
  /질문\s*대상.*교재/i,
  /^세부교재$/i,
];

/** 신규: 질문 대상 (강의 영상 위치) / 레거시(qnas 3): 세부강좌명 */
const LECTURE_COLUMN_PATTERNS = [
  /질문\s*대상.*강의/i,
  /^세부강좌명$/i,
];

export function findQALocationColumns(headers: string[]): QALocationColumns {
  return {
    textbookColumns: headers.filter((h) => TEXTBOOK_COLUMN_PATTERNS.some((p) => p.test(h))),
    lectureColumns: headers.filter((h) => LECTURE_COLUMN_PATTERNS.some((p) => p.test(h))),
  };
}

function normalizeBookText(bookName: string): string {
  return bookName
    .toLowerCase()
    .replace(/\[\[?|\]\]?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVideoTimestamp(ts: string | null): string | null {
  if (!ts) return null;
  let value = ts.startsWith(":") ? `00${ts}` : ts;
  const parts = value.split(":");
  if (parts.length === 2) {
    return `00:${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`;
  }
  if (parts.length === 3) {
    return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}:${parts[2].padStart(2, "0")}`;
  }
  return value;
}

const DEFAULT_LECTURE_TIME_TOLERANCE_MINUTES = 5;
const DEFAULT_LECTURE_HOTSPOT_SEGMENT_MINUTES = 10;

function getLectureTimeToleranceSeconds(): number {
  const env = process.env.LECTURE_TIME_TOLERANCE_MINUTES ?? process.env.LECTURE_TIME_BUCKET_MINUTES;
  if (!env) return DEFAULT_LECTURE_TIME_TOLERANCE_MINUTES * 60;
  const parsed = Number(env);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 60 : DEFAULT_LECTURE_TIME_TOLERANCE_MINUTES * 60;
}

/** 핫스팟 순위표용 고정 구간 길이 (전이적 ±5분 병합 방지) */
function getLectureHotspotSegmentSeconds(): number {
  const env = process.env.LECTURE_HOTSPOT_SEGMENT_MINUTES;
  if (!env) return DEFAULT_LECTURE_HOTSPOT_SEGMENT_MINUTES * 60;
  const parsed = Number(env);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 60 : DEFAULT_LECTURE_HOTSPOT_SEGMENT_MINUTES * 60;
}

function getLectureHotspotSegmentBounds(seconds: number): { start: number; end: number } {
  const size = getLectureHotspotSegmentSeconds();
  const start = Math.floor(seconds / size) * size;
  return { start, end: start + size };
}

function parseTimestampToSeconds(ts: string): number | null {
  const normalized = normalizeVideoTimestamp(ts);
  if (!normalized) return null;
  const parts = normalized.split(":").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function formatSecondsToTimestamp(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 영상은 00:00:00부터 시작 — 그 이전 시각은 없음. */
export function expandVideoTimeTolerance(
  minSec: number,
  maxSec: number
): { start: number; end: number } {
  const tolerance = getLectureTimeToleranceSeconds();
  const safeMin = Math.max(0, minSec);
  const safeMax = Math.max(safeMin, maxSec);
  return {
    start: Math.max(0, safeMin - tolerance),
    end: safeMax + tolerance,
  };
}

/** 질문 시각 기준 ±N분 (영상 시작 00:00:00 이전으로는 내려가지 않음) */
export function formatToleranceTimeRange(
  minSec: number | null,
  maxSec: number | null
): string {
  if (minSec === null || maxSec === null) return "미기입";
  const tolerance = getLectureTimeToleranceSeconds();
  const safeMin = Math.max(0, minSec);
  const safeMax = Math.max(safeMin, maxSec);
  const { start, end } = expandVideoTimeTolerance(safeMin, safeMax);
  const minutes = tolerance / 60;

  if (safeMin === safeMax) {
    return `${formatSecondsToTimestamp(safeMin)} ±${minutes}분 → ${formatSecondsToTimestamp(start)}~${formatSecondsToTimestamp(end)}`;
  }

  return `질문 ${formatSecondsToTimestamp(safeMin)}~${formatSecondsToTimestamp(safeMax)} (±${minutes}분 → ${formatSecondsToTimestamp(start)}~${formatSecondsToTimestamp(end)})`;
}

/** 핫스팟 순위표용 고정 구간 표시 (end는 구간 끝 시각, 포함) */
export function formatHotspotSegmentRange(startSec: number, endSecExclusive: number): string {
  const endInclusive = Math.max(startSec, endSecExclusive - 1);
  return `${formatSecondsToTimestamp(startSec)}~${formatSecondsToTimestamp(endInclusive)}`;
}

function getLectureGroupKey(session: string, day: string | null, title: string | null): string {
  const label = day ? `Day${Number(day)}` : normalizeLectureTitle(title);
  return `${session}|${label}`;
}

function updateLectureTimeRange(bucket: HotspotBucket, seconds: number): void {
  if (bucket.lectureSegmentFixed) return;
  if (bucket.lectureTimeMin === null || seconds < bucket.lectureTimeMin) {
    bucket.lectureTimeMin = seconds;
  }
  if (bucket.lectureTimeMax === null || seconds > bucket.lectureTimeMax) {
    bucket.lectureTimeMax = seconds;
  }
}

export function getBookFamily(bookName: string | null): string | null {
  if (!bookName || bookName === "[]") return "(교재명없음)";

  const normalized = normalizeBookText(bookName);

  if (/kiss?chema|키스\s*키마|키스키마/.test(normalized)) return "KISSCHEMA";
  if (/kissave|키스\s*에이브|키스에이브|키세이브/.test(normalized)) return "KISSAVE";
  if (/kiss\s*logic|키스\s*로직|키스로직/.test(normalized)) return "KISS_LOGIC";
  if (/매달\s*kiss|kiss\s*\[기출\]/.test(normalized)) return "KISS_MONTHLY";
  if (/듣보잡/.test(normalized)) return "DUTBOJAP";
  if (/eb-schema|eb\s*schema/.test(normalized)) return "EB_SCHEMA";
  if (/all\s*of\s*kice|predator/.test(normalized)) return "ALL_OF_KICE";
  if (/봄봄/.test(normalized)) return "BOMBOM";
  if (/미친개념/.test(normalized)) return "MICHIN_GAENYOM";
  if (/n티켓|nticket/.test(normalized)) return "NTICKET";
  if (/literacy|매월승리/.test(normalized)) return "LITERACY";
  if (/김승리/.test(normalized)) return "KIM_SEUNGRI";

  return bookName.replace(/^\[+|\]+$/g, "").trim() || "(교재명없음)";
}

/**
 * 매칭키용 교재 식별자. 교재명이 다르면 페이지·문항이 같아도 별도 집계합니다.
 */
export function normalizeBookSeriesSlug(bookName: string): string {
  return normalizeBookText(bookName)
    .replace(/^교재\s+/, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9\uac00-\ud7a3_().~:-]/g, "");
}

export function getBookSeriesKey(bookName: string | null): string | null {
  if (!bookName || bookName === "[]") return "(교재명없음)";

  const slug = normalizeBookSeriesSlug(bookName);
  return slug || "(교재명없음)";
}

function extractBookNameFromRawLocation(raw: string): string | null {
  const pageIdx = raw.search(TEXTBOOK_PAGE_PATTERN);
  if (pageIdx <= 0) return null;
  return raw.slice(0, pageIdx).trim();
}

function formatSeriesKeyLabel(seriesKey: string): string {
  return seriesKey.replace(/_/g, " ");
}

function parseQuestionNumber(label: string | null): number | null {
  if (!label || /미\s*기입/i.test(label)) return null;
  if (!/^\d+$/.test(label)) return null;
  return Number.parseInt(label, 10);
}

function buildTextbookMatchKey(
  bookSeriesKey: string | null,
  page: number | null,
  questionNumber: number | null
): string | null {
  if (page === null || questionNumber === null || !bookSeriesKey) return null;
  return `${bookSeriesKey}|P${page}|Q${questionNumber}`;
}

function normalizeLectureTitle(title: string | null): string {
  if (!title) return "-";
  return title.replace(/\s+/g, " ").trim().slice(0, 50);
}

function buildLectureMatchKey(
  session: string | null,
  day: string | null,
  title: string | null,
  videoTimestamp: string | null
): string | null {
  if (!session) return null;
  const label = day ? `Day${Number(day)}` : normalizeLectureTitle(title);
  const ts = videoTimestamp ?? "-";
  return `${session}|${label}|${ts}`;
}

/**
 * 교재 위치 — 4개 파일 공통 패턴:
 * [[2027] KISSCHEMA] 페이지수 :129 문제번호 :2
 * [[교재] 2027 KISSCHEMA (2권 구성)] 페이지수 :94 문제번호 :1
 * [[교재] 2027 봄봄 기출 독서의 패턴] 페이지수 :91 문제번호 :2
 * [LITERACY 「될」 ...] 페이지수 :48 문제번호 :1
 * [] 페이지수 :39 문제번호 :미 기입
 */
export function parseTextbookLocation(text: string, sourceColumn = ""): ParsedTextbookLocation | null {
  const raw = text.trim();
  if (!raw || !TEXTBOOK_PAGE_PATTERN.test(raw)) return null;

  const pageMatch = raw.match(TEXTBOOK_PAGE_PATTERN);
  const questionMatch = raw.match(TEXTBOOK_QUESTION_PATTERN);

  const page = pageMatch ? Number(pageMatch[1]) : null;
  const questionLabel = questionMatch?.[1] ?? null;
  const questionNumber = parseQuestionNumber(questionLabel);

  const pageIdx = raw.search(TEXTBOOK_PAGE_PATTERN);
  const bookName = pageIdx > 0 ? raw.slice(0, pageIdx).trim() : null;
  const bookFamily = getBookFamily(bookName);
  const bookSeriesKey = getBookSeriesKey(bookName);

  return {
    raw,
    bookName,
    bookFamily,
    bookSeriesKey,
    page,
    questionNumber,
    questionLabel: questionLabel?.replace(/\s+/g, " ").trim() ?? null,
    matchKey: buildTextbookMatchKey(bookSeriesKey, page, questionNumber),
    sourceColumn,
  };
}

/**
 * 강의 위치 — 파일별 변형:
 * (4) 14차시 / Day 14. 독해 스키마 동영상 위치 00:05:24
 * (4) 0차시 / OT  |  4차시 / 후반부  |  2차시 / Day 02
 * (3) 19차시 / 증가와 감소 연습문제 동영상 위치 00:14:18
 * (5) 29차시 / [Theme 04] Chapter 1. ... 동영상 위치 00:01:16
 * (5) 16차시 / [T.1.M] 제5회 - ②
 * (5) 125차시 / ... 동영상 위치 :10:15  (시 앞 00 생략)
 * (6) 3차시 / 화자와 대상 동영상 위치 00:40:03
 * (6) 20차시 / 13강 소설의 갈등 동영상 위치 :18:00
 */
export function parseLectureLocation(text: string, sourceColumn = ""): ParsedLectureLocation | null {
  const raw = text.trim();
  if (!raw || !LECTURE_SESSION_PREFIX.test(raw)) return null;

  const sessionMatch = raw.match(LECTURE_SESSION_PREFIX);
  if (!sessionMatch) return null;

  const session = sessionMatch[1];
  let remainder = raw.slice(sessionMatch[0].length).trim();

  const videoMatch = remainder.match(LECTURE_VIDEO_PATTERN);
  const videoTimestamp = normalizeVideoTimestamp(videoMatch?.[1] ?? null);

  if (videoMatch?.index !== undefined) {
    remainder = remainder.slice(0, videoMatch.index).trim();
  }

  const dayMatch = remainder.match(LECTURE_DAY_PATTERN);
  let day: string | null = null;
  let title = remainder;

  if (dayMatch) {
    day = dayMatch[1];
    title = dayMatch[2].trim();
  }

  return {
    raw,
    session,
    day,
    title: title || null,
    videoTimestamp,
    matchKey: buildLectureMatchKey(session, day, title, videoTimestamp),
    sourceColumn,
  };
}

function getColumnsToScan(
  row: Record<string, unknown>,
  headers?: string[]
): Array<[string, unknown]> {
  if (!headers) return Object.entries(row);

  const { textbookColumns, lectureColumns } = findQALocationColumns(headers);
  if (textbookColumns.length === 0 && lectureColumns.length === 0) {
    return Object.entries(row);
  }

  return [
    ...textbookColumns.map((col) => [col, row[col]] as [string, unknown]),
    ...lectureColumns.map((col) => [col, row[col]] as [string, unknown]),
  ];
}

export function analyzeRowLocations(
  row: Record<string, unknown>,
  headers?: string[]
): RowLocationAnalysis {
  const textbook: ParsedTextbookLocation[] = [];
  const lecture: ParsedLectureLocation[] = [];

  for (const [column, value] of getColumnsToScan(row, headers)) {
    if (column.startsWith("__")) continue;
    const text = String(value ?? "").trim();
    if (!text) continue;

    const parsedTextbook = parseTextbookLocation(text, column);
    if (parsedTextbook) textbook.push(parsedTextbook);

    const parsedLecture = parseLectureLocation(text, column);
    if (parsedLecture) lecture.push(parsedLecture);
  }

  const primaryTextbook = textbook.find((t) => t.matchKey) ?? textbook[0] ?? null;
  const primaryLecture = lecture.find((l) => l.matchKey) ?? lecture[0] ?? null;

  return {
    textbook,
    lecture,
    primaryTextbookKey: primaryTextbook?.matchKey ?? null,
    primaryLectureKey: primaryLecture?.matchKey ?? null,
  };
}

function truncateText(value: unknown, maxChars: number): unknown {
  const text = String(value ?? "");
  if (text.length <= maxChars) return value;
  return `${text.slice(0, maxChars)}…(생략)`;
}

export function compactRowForAI(
  row: Record<string, unknown>,
  headers: string[],
  maxBodyChars = 2000
): Record<string, unknown> {
  const { textbookColumns, lectureColumns } = findQALocationColumns(headers);
  const analysis = analyzeRowLocations(row, headers);
  const compact: Record<string, unknown> = {};

  for (const header of headers) {
    const isLocationCol = textbookColumns.includes(header) || lectureColumns.includes(header);
    const isKeyCol = /^(게시날짜|회사|과목|세부과목|강사|강좌명|세부강좌명|세부교재|제목|본문|답변|학년|등급|과정)/.test(
      header
    );
    if (!isLocationCol && !isKeyCol) continue;

    const value = row[header];
    if (header === "본문" || header === "답변") {
      compact[header] = truncateText(value, maxBodyChars);
    } else {
      compact[header] = value;
    }
  }

  const primaryTb = analysis.textbook.find((t) => t.matchKey) ?? analysis.textbook[0];
  if (primaryTb?.matchKey) {
    compact.__주교재_매칭키 = primaryTb.matchKey;
    compact.__주교재_계열 = primaryTb.bookFamily;
    compact.__주교재_시리즈 = primaryTb.bookSeriesKey;
    compact.__교재_페이지 = primaryTb.page;
    compact.__교재_문제번호 = primaryTb.questionNumber;
  }
  if (analysis.primaryLectureKey) {
    compact.__주강의_매칭키 = analysis.primaryLectureKey;
  }

  return compact;
}

export function prioritizeRowsForAI(
  rows: Record<string, unknown>[],
  headers: string[]
): Record<string, unknown>[] {
  const withLocation: Record<string, unknown>[] = [];
  const withoutLocation: Record<string, unknown>[] = [];

  for (const row of rows) {
    const analysis = analyzeRowLocations(row, headers);
    if (analysis.primaryTextbookKey || analysis.primaryLectureKey) {
      withLocation.push(row);
    } else {
      withoutLocation.push(row);
    }
  }

  return [...withLocation, ...withoutLocation];
}

export function enrichRowForAI(
  row: Record<string, unknown>,
  headers?: string[]
): Record<string, unknown> {
  const analysis = analyzeRowLocations(row, headers);

  if (analysis.textbook.length === 0 && analysis.lecture.length === 0) {
    return row;
  }

  const primaryTb = analysis.textbook.find((t) => t.matchKey) ?? analysis.textbook[0];

  return {
    ...row,
    __위치_분석: {
      교재: analysis.textbook.map((t) => ({
        교재명_원문: t.bookName,
        교재계열: t.bookFamily,
        교재시리즈: t.bookSeriesKey,
        페이지: t.page,
        문제번호: t.questionNumber,
        문제번호_원문: t.questionLabel,
        매칭키: t.matchKey,
        출처컬럼: t.sourceColumn,
        원문: t.raw,
      })),
      강의: analysis.lecture.map((l) => ({
        차시: l.session,
        Day: l.day,
        제목: l.title,
        동영상위치: l.videoTimestamp,
        동영상구간:
          l.videoTimestamp && parseTimestampToSeconds(l.videoTimestamp) !== null
            ? formatToleranceTimeRange(
                parseTimestampToSeconds(l.videoTimestamp)!,
                parseTimestampToSeconds(l.videoTimestamp)!
              )
            : null,
        매칭키: l.matchKey,
        출처컬럼: l.sourceColumn,
        원문: l.raw,
      })),
      주교재_매칭키: analysis.primaryTextbookKey,
      주교재_계열: primaryTb?.bookFamily ?? null,
      주교재_시리즈: primaryTb?.bookSeriesKey ?? null,
      주강의_매칭키: analysis.primaryLectureKey,
    },
  };
}

export function buildQASchemaGuide(columns: QALocationColumns): string {
  const parts = [
    "### Q&A 위치 컬럼 스키마 (qnas 3~6 실데이터 기준)",
    "",
    "**위치는 전용 컬럼 값만 사용. 제목·본문에서 페이지/문항/차시를 추측하지 마세요.**",
    "",
  ];

  if (columns.textbookColumns.length > 0) {
    parts.push(`**교재 위치 컬럼:** \`${columns.textbookColumns.join("`, `")}\``);
    parts.push(
      "- 공통 형식: `{교재명}] 페이지수 :{N} 문제번호 :{M}`",
      "  - 예: `[[2027] KISSCHEMA] 페이지수 :129 문제번호 :2`",
      "  - 예: `[[교재] 2027 봄봄 기출 독서의 패턴] 페이지수 :91 문제번호 :2`",
      "  - 예: `[LITERACY 「될」 ...] 페이지수 :48 문제번호 :1`",
      '  - `문제번호 :미 기입` → 문항 매칭 불가',
      "  - `문제번호 :03` → 3번과 동일",
      "- **매칭키 = 정규화된 교재명 + 페이지 + 문제번호** (교재명·페이지·문항이 모두 같을 때만 동일 문항)",
      "- **페이지·문항만 같고 교재명이 다르면 다른 문항** (예: 매월승리 4호 P28 Q6 ≠ 매월승리 1호 P28 Q6)",
      "- KISSCHEMA(키스키마) ≠ KISSAVE(키세이브) ≠ KISS_LOGIC — **다른 교재**",
      "- EB-Schema [수특] 과학기술 ≠ 사회문화 ≠ 인문예술 — **다른 별책**",
      "- qnas(3) 레거시: `세부교재` 컬럼에 동일 형식",
      ""
    );
  }

  if (columns.lectureColumns.length > 0) {
    parts.push(`**강의 위치 컬럼:** \`${columns.lectureColumns.join("`, `")}\``);
    parts.push(
      "- 공통: `{N}차시 / {내용} [동영상 위치 {시:분:초}]`",
      "  - KISS형: `14차시 / Day 14. 독해 스키마 동영상 위치 00:05:24`",
      "  - OT형: `0차시 / OT` 또는 `0차시 / OT 동영상 위치 00:16:07`",
      "  - 구간형: `4차시 / 후반부`, `2차시 / 전반부`",
      "  - 제목형: `3차시 / 화자와 대상 동영상 위치 00:40:03`",
      "  - 브래킷형: `16차시 / [T.1.M] 제5회 - ②`",
      "  - 시 생략: `동영상 위치 :10:15` → `00:10:15`로 해석",
      `- **동영상 핫스팟 순위표**: 영상을 **${DEFAULT_LECTURE_HOTSPOT_SEGMENT_MINUTES}분 고정 구간**으로 나눠 집계 (전이적 ±5분 병합 없음)`,
      `- **왜 분석·특정 시각 매칭**: 질문 시각 기준 ±${DEFAULT_LECTURE_TIME_TOLERANCE_MINUTES}분 (영상 **00:00:00**부터, 그 이전 없음)`,
      "- qnas(3) 레거시: `세부강좌명` 컬럼에 동일 형식",
      ""
    );
  }

  return parts.join("\n");
}

interface HotspotPost {
  date: string;
  title: string;
  body: string;
  answer: string;
}

interface HotspotBucket {
  count: number;
  rawLocation: string;
  bookName: string | null;
  matchKey: string;
  lectureTimeMin: number | null;
  lectureTimeMax: number | null;
  /** 고정 구간 핫스팟이면 min/max를 질문 시각으로 늘리지 않음 */
  lectureSegmentFixed?: boolean;
  samples: Array<{ date: string; title: string; body: string }>;
  allPosts: HotspotPost[];
}

const DEFAULT_DIGEST_BODY_CHARS = 3000;
const DEFAULT_LOCATION_DIGEST_CHARS = 80_000;

function getDigestBodyChars(): number {
  const env = process.env.GEMINI_MAX_DIGEST_BODY_CHARS;
  if (!env) return DEFAULT_DIGEST_BODY_CHARS;
  const parsed = Number(env);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DIGEST_BODY_CHARS;
}

function getLocationDigestChars(): number {
  const env = process.env.GEMINI_MAX_LOCATION_DIGEST_CHARS;
  if (!env) return DEFAULT_LOCATION_DIGEST_CHARS;
  const parsed = Number(env);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LOCATION_DIGEST_CHARS;
}

function extractRowPost(row: Record<string, unknown>, maxBodyChars: number): HotspotPost {
  return {
    date: getField(row, "게시날짜"),
    title: getField(row, "제목"),
    body: getField(row, "본문").slice(0, maxBodyChars),
    answer: getField(row, "답변").slice(0, maxBodyChars),
  };
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

function addToBucket(
  buckets: Map<string, HotspotBucket>,
  key: string,
  row: Record<string, unknown>,
  rawLocation: string,
  maxSamples: number,
  collectAllPosts = false,
  videoSeconds: number | null = null,
  fixedLectureSegment: { start: number; end: number } | null = null
): void {
  const maxBodyChars = getDigestBodyChars();
  const post = extractRowPost(row, maxBodyChars);
  const sample = { date: post.date, title: post.title, body: post.body.slice(0, 200) };

  const existing = buckets.get(key);

  if (existing) {
    existing.count += 1;
    if (existing.samples.length < maxSamples && sample.body) {
      existing.samples.push(sample);
    }
    if (collectAllPosts && (post.body || post.title)) {
      existing.allPosts.push(post);
    }
    if (videoSeconds !== null) {
      updateLectureTimeRange(existing, videoSeconds);
    }
  } else {
    buckets.set(key, {
      count: 1,
      rawLocation,
      bookName: extractBookNameFromRawLocation(rawLocation),
      matchKey: key,
      lectureTimeMin: fixedLectureSegment?.start ?? videoSeconds,
      lectureTimeMax: fixedLectureSegment?.end ?? videoSeconds,
      lectureSegmentFixed: fixedLectureSegment !== null,
      samples: sample.body ? [sample] : [],
      allPosts: collectAllPosts && (post.body || post.title) ? [post] : [],
    });
  }
}

function parseHotspotKey(key: string): { family: string; page: string; question: string } | null {
  const match = key.match(/^([^|]+)\|P(\d+)\|Q(\d+)$/);
  if (!match) return null;
  return { family: match[1], page: match[2], question: match[3] };
}

function parseLectureHotspotKey(
  key: string
): { session: string; label: string; timestamp: string } | null {
  const match = key.match(/^([^|]+)\|([^|]+)\|([^|]+)$/);
  if (!match) return null;
  return { session: match[1], label: match[2], timestamp: match[3] };
}

function formatTextbookLocationLabel(bucket: HotspotBucket, key: string): string {
  const parsed = parseHotspotKey(key);
  const bookLabel = bucket.bookName || (parsed ? formatSeriesKeyLabel(parsed.family) : key);
  return parsed ? `${bookLabel} P${parsed.page} Q${parsed.question}` : key;
}

function formatLectureLocationLabel(
  key: string,
  rawLocation?: string,
  bucket?: HotspotBucket
): string {
  const parsed = parseLectureHotspotKey(key);
  if (!parsed) return rawLocation || key;
  const ts =
    bucket &&
    bucket.lectureTimeMin !== null &&
    bucket.lectureTimeMax !== null
      ? bucket.lectureSegmentFixed
        ? ` @ ${formatHotspotSegmentRange(bucket.lectureTimeMin, bucket.lectureTimeMax)}`
        : ` @ ${formatToleranceTimeRange(bucket.lectureTimeMin, bucket.lectureTimeMax)}`
      : parsed.timestamp !== "-"
        ? ` @ ${parsed.timestamp}`
        : "";
  return `${parsed.session} / ${parsed.label}${ts}`;
}

function formatTextbookHotspotSummaryTable(
  title: string,
  buckets: Map<string, HotspotBucket>,
  topN: number
): string[] {
  const sorted = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count);
  if (sorted.length === 0) return [];

  const parts = [
    "",
    `#### ${title} — 순위표 (전체 데이터 집계, 이 표의 건수만 사용)`,
    "",
    "| 순위 | 교재명 | 페이지·문항 | 질문 수 |",
    "| --- | --- | --- | ---: |",
  ];

  sorted.slice(0, topN).forEach(([key, bucket], index) => {
    const parsed = parseHotspotKey(key);
    const bookName = (bucket.bookName || parsed?.family || key).replace(/\|/g, "\\|");
    const pq = parsed ? `P${parsed.page} Q${parsed.question}` : "-";
    parts.push(`| ${index + 1} | ${bookName} | ${pq} | **${bucket.count}건** |`);
  });

  if (sorted.length > topN) {
    parts.push(`| … | … | … | 외 ${sorted.length - topN}개 위치 |`);
  }

  return parts;
}

function formatLectureHotspotSummaryTable(
  title: string,
  buckets: Map<string, HotspotBucket>,
  topN: number
): string[] {
  const sorted = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count);
  if (sorted.length === 0) return [];

  const parts = [
    "",
    `#### ${title} — 순위표 (전체 데이터 집계, 이 표의 건수만 사용)`,
    "",
    "| 순위 | 차시 | 구간·제목 | 동영상 구간 | 질문 수 |",
    "| --- | --- | --- | --- | ---: |",
  ];

  sorted.slice(0, topN).forEach(([key, bucket], index) => {
    const parsed = parseLectureHotspotKey(key);
    const session = (parsed?.session || "-").replace(/\|/g, "\\|");
    const label = (parsed?.label || "-").replace(/\|/g, "\\|");
    const timestamp =
      bucket.lectureTimeMin !== null && bucket.lectureTimeMax !== null
        ? bucket.lectureSegmentFixed
          ? formatHotspotSegmentRange(bucket.lectureTimeMin, bucket.lectureTimeMax)
          : formatToleranceTimeRange(bucket.lectureTimeMin, bucket.lectureTimeMax)
        : "미기입";
    parts.push(`| ${index + 1} | ${session} | ${label} | ${timestamp} | **${bucket.count}건** |`);
  });

  if (sorted.length > topN) {
    parts.push(`| … | … | … | … | 외 ${sorted.length - topN}개 구간 |`);
  }

  return parts;
}

function formatSessionHotspotSummaryTable(
  title: string,
  buckets: Map<string, HotspotBucket>,
  topN: number
): string[] {
  const sorted = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count);
  if (sorted.length === 0) return [];

  const parts = [
    "",
    `#### ${title} — 순위표 (차시 단위 참고용)`,
    "",
    "| 순위 | 차시 | 질문 수 |",
    "| --- | --- | ---: |",
  ];

  sorted.slice(0, topN).forEach(([key, bucket], index) => {
    parts.push(`| ${index + 1} | ${key.replace(/\|/g, "\\|")} | **${bucket.count}건** |`);
  });

  if (sorted.length > topN) {
    parts.push(`| … | … | 외 ${sorted.length - topN}개 차시 |`);
  }

  return parts;
}

function formatHotspotSummaryTable(
  title: string,
  buckets: Map<string, HotspotBucket>,
  topN: number
): string[] {
  return formatTextbookHotspotSummaryTable(title, buckets, topN);
}

function formatHotspotList(
  title: string,
  buckets: Map<string, HotspotBucket>,
  topN: number,
  kind: "textbook" | "lecture" | "session" = "textbook"
): string[] {
  const sorted = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count);
  if (sorted.length === 0) return [];

  const parts = [
    "",
    `#### ${title} — 질문 예시 (참고용, 건수 집계 아님)`,
    "",
    "아래 '질문 예시'는 위 순위표 각 항목당 최대 2건만 보여 줍니다. **예시 개수(1~2개)로 질문 수를 세지 마세요.**",
  ];

  sorted.slice(0, topN).forEach(([key, bucket], index) => {
    const label =
      kind === "lecture"
        ? formatLectureLocationLabel(key, bucket.rawLocation, bucket)
        : kind === "session"
          ? key
          : formatTextbookLocationLabel(bucket, key);
    parts.push(`${index + 1}. **${label}** — 질문 수 **${bucket.count}건** (전체 집계)`);
    if (bucket.rawLocation) parts.push(`   - 위치: ${bucket.rawLocation}`);
    bucket.samples.forEach((s, sampleIdx) => {
      const meta = [s.date, s.title].filter(Boolean).join(" | ");
      parts.push(
        `   - 예시 ${sampleIdx + 1}/${bucket.samples.length}${meta ? ` (${meta})` : ""}: "${s.body}"`
      );
    });
    if (bucket.count > bucket.samples.length) {
      parts.push(
        `   - (동일 위치 질문 ${bucket.count - bucket.samples.length}건 추가 — 본문은 '질문 본문 종합' 섹션 참고)`
      );
    }
  });

  if (sorted.length > topN) {
    parts.push(`   - ... 외 ${sorted.length - topN}개 위치`);
  }

  return parts;
}

function formatLocationLabel(bucket: HotspotBucket, key: string): string {
  return formatTextbookLocationLabel(bucket, key);
}

function formatPostsDigest(
  bucket: HotspotBucket,
  key: string,
  maxLocationChars: number,
  getLabel: (bucket: HotspotBucket, key: string) => string
): string[] {
  const parts: string[] = [];
  const label = getLabel(bucket, key);
  const included: HotspotPost[] = [];
  let usedChars = 0;
  let truncated = false;

  for (const post of bucket.allPosts) {
    const postText = [post.title, post.body, post.answer].filter(Boolean).join("\n");
    const postLen = postText.length + 80;
    if (usedChars + postLen > maxLocationChars && included.length > 0) {
      truncated = true;
      break;
    }
    included.push(post);
    usedChars += postLen;
    if (usedChars >= maxLocationChars) {
      truncated = included.length < bucket.allPosts.length;
      break;
    }
  }

  parts.push(
    `##### ${label} — 질문 **${bucket.count}건** (본문 종합 ${included.length}/${bucket.allPosts.length}건)`
  );
  if (bucket.rawLocation) parts.push(`- 매칭키: \`${key}\``);
  parts.push(`- 위치: ${bucket.rawLocation}`);
  parts.push("");

  included.forEach((post, index) => {
    const meta = [post.date, post.title].filter(Boolean).join(" | ");
    parts.push(`**[질문 ${index + 1}/${bucket.count}]**${meta ? ` (${meta})` : ""}`);
    if (post.body) parts.push(`> ${post.body.replace(/\n/g, "\n> ")}`);
    if (post.answer) parts.push(`- 답변: ${post.answer.replace(/\n/g, " ")}`);
    parts.push("");
  });

  if (truncated || included.length < bucket.allPosts.length) {
    parts.push(
      `⚠️ 본문이 길어 ${bucket.allPosts.length - included.length}건은 생략되었습니다. 집계 건수는 **${bucket.count}건**입니다.`,
      ""
    );
  }

  return parts;
}

function formatHotspotBodyDigest(
  title: string,
  buckets: Map<string, HotspotBucket>,
  topN: number,
  kind: "textbook" | "lecture"
): string[] {
  const sorted = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count);
  const targets = sorted.slice(0, topN).filter(([, bucket]) => bucket.allPosts.length > 0);
  if (targets.length === 0) return [];

  const maxLocationChars = getLocationDigestChars();
  const locationLabel = kind === "lecture" ? "강의·동영상 구간" : "교재 위치";
  const getLabel =
    kind === "lecture"
      ? (bucket: HotspotBucket, key: string) =>
          formatLectureLocationLabel(key, bucket.rawLocation, bucket)
      : formatTextbookLocationLabel;

  const parts = [
    "",
    `#### ${title} — 질문 본문 종합 (왜 분석용, 서버 전체 수집)`,
    "",
    `아래는 각 ${locationLabel}의 **전체 질문 본문**을 서버에서 수집·종합한 것입니다.`,
    "'왜 이 위치에서 질문이 많은지' 분석할 때 **반드시 이 섹션의 본문 전체**를 읽고 패턴을 도출하세요.",
    "질문 예시(2건)만으로 why 분석을 하지 마세요.",
    "",
  ];

  for (const [key, bucket] of targets) {
    parts.push(...formatPostsDigest(bucket, key, maxLocationChars, getLabel));
  }

  return parts;
}

export function buildTextbookHotspotBuckets(
  rows: Record<string, unknown>[],
  headers?: string[]
): Map<string, HotspotBucket> {
  const textbookBuckets = new Map<string, HotspotBucket>();

  for (const row of rows) {
    const analysis = analyzeRowLocations(row, headers);
    if (!analysis.primaryTextbookKey) continue;

    const tb = analysis.textbook.find((t) => t.matchKey) ?? analysis.textbook[0];
    addToBucket(
      textbookBuckets,
      analysis.primaryTextbookKey,
      row,
      tb?.raw ?? "",
      2,
      true
    );
  }

  return textbookBuckets;
}

export function buildLectureHotspotBuckets(
  rows: Record<string, unknown>[],
  headers?: string[]
): Map<string, HotspotBucket> {
  const lectureBuckets = new Map<string, HotspotBucket>();
  const groups = new Map<
    string,
    Array<{ row: Record<string, unknown>; seconds: number | null; raw: string }>
  >();

  for (const row of rows) {
    const analysis = analyzeRowLocations(row, headers);
    if (!analysis.primaryLectureKey) continue;

    const lec = analysis.lecture.find((l) => l.matchKey) ?? analysis.lecture[0];
    if (!lec?.session) continue;

    const groupKey = getLectureGroupKey(lec.session, lec.day, lec.title);
    const seconds = lec.videoTimestamp ? parseTimestampToSeconds(lec.videoTimestamp) : null;

    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push({ row, seconds, raw: lec.raw });
  }

  for (const [groupKey, items] of groups) {
    for (const item of items.filter((i) => i.seconds === null)) {
      addToBucket(lectureBuckets, `${groupKey}|-`, item.row, item.raw, 2, true, null);
    }

    const timed = items.filter((i) => i.seconds !== null) as Array<{
      row: Record<string, unknown>;
      seconds: number;
      raw: string;
    }>;

    for (const item of timed) {
      const segment = getLectureHotspotSegmentBounds(item.seconds);
      const segmentKey = `${groupKey}|${formatSecondsToTimestamp(segment.start)}`;
      addToBucket(
        lectureBuckets,
        segmentKey,
        item.row,
        item.raw,
        2,
        true,
        item.seconds,
        segment
      );
    }
  }

  return lectureBuckets;
}

function extractSessionFromUserText(text: string): string | null {
  const match = text.match(/(\d+)\s*차시/);
  return match ? `${match[1]}차시` : null;
}

function extractVideoTimestampFromUserText(text: string): string | null {
  const patterns = [
    /동영상\s*위치\s*:?\s*(\d{1,2}:\d{2}(?::\d{2})?)/i,
    /(?:@|시간\s*)?(\d{1,2}:\d{2}(?::\d{2})?)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return normalizeVideoTimestamp(match[1]);
  }
  return null;
}

function lectureBucketMatchesUserTime(bucket: HotspotBucket, userTimestamp: string): boolean {
  const userSec = parseTimestampToSeconds(userTimestamp);
  if (userSec === null) return false;
  if (bucket.lectureTimeMin === null || bucket.lectureTimeMax === null) return false;

  if (bucket.lectureSegmentFixed) {
    return userSec >= bucket.lectureTimeMin && userSec < bucket.lectureTimeMax;
  }

  const { start, end } = expandVideoTimeTolerance(bucket.lectureTimeMin, bucket.lectureTimeMax);
  return userSec >= start && userSec <= end;
}

interface LectureWhyGroup {
  key: string;
  label: string;
  rawLocation: string;
  posts: HotspotPost[];
}

function collectLecturePostsNearTime(
  rows: Record<string, unknown>[],
  headers: string[] | undefined,
  session: string | null,
  centerSec: number,
  toleranceSec: number
): LectureWhyGroup[] {
  const groups = new Map<string, LectureWhyGroup>();
  const maxBodyChars = getDigestBodyChars();

  for (const row of rows) {
    const analysis = analyzeRowLocations(row, headers);
    if (!analysis.primaryLectureKey) continue;

    const lec = analysis.lecture.find((l) => l.matchKey) ?? analysis.lecture[0];
    if (!lec?.session) continue;
    if (session && lec.session !== session) continue;

    const sec = lec.videoTimestamp ? parseTimestampToSeconds(lec.videoTimestamp) : null;
    if (sec === null) continue;
    if (Math.abs(sec - centerSec) > toleranceSec) continue;

    const groupKey = getLectureGroupKey(lec.session, lec.day, lec.title);
    const label = `${lec.session} / ${lec.day ? `Day${Number(lec.day)}` : normalizeLectureTitle(lec.title) ?? "-"}`;
    const post = extractRowPost(row, maxBodyChars);

    const existing = groups.get(groupKey);
    if (existing) {
      existing.posts.push(post);
    } else {
      groups.set(groupKey, {
        key: groupKey,
        label,
        rawLocation: lec.raw,
        posts: [post],
      });
    }
  }

  return [...groups.values()].sort((a, b) => b.posts.length - a.posts.length);
}

function formatPostsDigestFromCollection(
  label: string,
  key: string,
  rawLocation: string,
  posts: HotspotPost[],
  maxLocationChars: number
): string[] {
  const bucket: HotspotBucket = {
    count: posts.length,
    rawLocation,
    bookName: null,
    matchKey: key,
    lectureTimeMin: null,
    lectureTimeMax: null,
    allPosts: posts,
    samples: [],
  };

  return formatPostsDigest(bucket, key, maxLocationChars, () => label);
}

function findLectureBucketsMatchingUserQuery(
  buckets: Map<string, HotspotBucket>,
  userText: string
): Array<[string, HotspotBucket]> {
  const session = extractSessionFromUserText(userText);
  const timestamp = extractVideoTimestampFromUserText(userText);
  const hasLectureHint = /(강의|차시|동영상|영상|영상\s*위치)/i.test(userText);

  if (!session && !timestamp) {
    if (hasLectureHint) {
      return [...buckets.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
    }
    return [];
  }

  const matches: Array<[string, HotspotBucket]> = [];

  for (const [key, bucket] of buckets) {
    const parsed = parseLectureHotspotKey(key);
    if (!parsed) continue;

    const sessionMatch = !session || parsed.session === session;
    const timestampMatch =
      !timestamp || lectureBucketMatchesUserTime(bucket, timestamp);

    if (sessionMatch && timestampMatch) {
      matches.push([key, bucket]);
    }
  }

  return matches.sort((a, b) => b[1].count - a[1].count);
}

export function buildLectureWhyDigestFromUserQuery(
  rows: Record<string, unknown>[],
  headers: string[] | undefined,
  userText: string
): string | null {
  const text = userText.trim();
  if (!text) return null;

  const shouldDigest =
    /(강의|차시|동영상|영상|막히|왜|이유|원인|분석|많이|핫스팟|본문|질문\s*유형)/i.test(text);
  if (!shouldDigest) return null;

  const session = extractSessionFromUserText(text);
  const timestamp = extractVideoTimestampFromUserText(text);
  const maxLocationChars = getLocationDigestChars();
  const tolerance = getLectureTimeToleranceSeconds();
  const toleranceMin = tolerance / 60;

  if (timestamp) {
    const userSec = parseTimestampToSeconds(timestamp);
    if (userSec === null) return null;

    const groups = collectLecturePostsNearTime(rows, headers, session, userSec, tolerance);
    if (groups.length === 0) return null;

    const { start, end } = expandVideoTimeTolerance(userSec, userSec);
    const parts = [
      "### 사용자 질의 강의 위치 — 질문 본문 종합 (왜 분석용)",
      "",
      `사용자가 언급한 동영상 시각 **${formatSecondsToTimestamp(userSec)}** 기준 ±${toleranceMin}분 (${formatSecondsToTimestamp(start)}~${formatSecondsToTimestamp(end)})에 해당하는 질문 **전체 본문**입니다.`,
      "**차시만 보고 분석하지 말고, 동영상 위치(타임스탬프) 단위로 해석하세요.**",
      "",
    ];

    for (const group of groups.slice(0, 5)) {
      parts.push(
        ...formatPostsDigestFromCollection(
          `${group.label} @ ${formatToleranceTimeRange(userSec, userSec)}`,
          group.key,
          group.rawLocation,
          group.posts,
          maxLocationChars
        )
      );
    }

    if (groups.length > 5) {
      parts.push(`… 외 ${groups.length - 5}개 강의 구간도 일치하지만 생략했습니다.`, "");
    }

    return parts.join("\n");
  }

  const buckets = buildLectureHotspotBuckets(rows, headers);
  const matches = findLectureBucketsMatchingUserQuery(buckets, text);
  if (matches.length === 0) return null;

  const parts = [
    "### 사용자 질의 강의 위치 — 질문 본문 종합 (왜 분석용)",
    "",
    "사용자가 언급한 강의·동영상 구간과 일치하는 질문의 **전체 본문**입니다. '어느 구간에서/왜 막혔는지' 분석 시 이 섹션을 우선 사용하세요.",
    "**차시만 보고 분석하지 말고, 동영상 위치(타임스탬프) 단위로 해석하세요.**",
    "",
  ];

  for (const [key, bucket] of matches.slice(0, 5)) {
    parts.push(
      ...formatPostsDigest(bucket, key, maxLocationChars, (_bucket, matchKey) =>
        formatLectureLocationLabel(matchKey, bucket.rawLocation, bucket)
      )
    );
  }

  if (matches.length > 5) {
    parts.push(`… 외 ${matches.length - 5}개 구간도 일치하지만 생략했습니다.`, "");
  }

  return parts.join("\n");
}

export function buildLectureWhyDigestsFromMessages(
  rows: Record<string, unknown>[],
  headers: string[] | undefined,
  userTexts: string[]
): string | null {
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const text of [...userTexts].reverse()) {
    const digest = buildLectureWhyDigestFromUserQuery(rows, headers, text);
    if (!digest || seen.has(digest)) continue;
    seen.add(digest);
    parts.push(digest);
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

function normalizeQueryText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

function extractPageFromUserText(text: string): number | null {
  const patterns = [
    /(?:p\.?|페이지\s*수?\s*[:：]?)\s*(\d+)\s*(?:p|페이지)?/i,
    /(\d+)\s*p\b/i,
    /(\d+)\s*(?:p|페이지)(?:\s*[,，]|\s+|$)/i,
    /페이지\s*(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number.parseInt(match[1], 10);
  }
  return null;
}

function extractQuestionFromUserText(text: string): number | null {
  const patterns = [
    /(?:q\.?|문제\s*번호?\s*[:：]?|문항?\s*번호?\s*[:：]?)\s*(\d+)/i,
    /(\d+)\s*번(?:\s*문항|\s*문제|\s*지문)?/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number.parseInt(match[1], 10);
  }
  return null;
}

function bookNameMatchesUserQuery(bookName: string | null, userText: string): boolean {
  if (!bookName) return false;
  const normalizedBook = normalizeQueryText(bookName);
  const normalizedUser = normalizeQueryText(userText);

  if (normalizedUser.includes(normalizedBook.replace(/\[\[?|\]\]?/g, "").trim())) {
    return true;
  }

  const tokens = normalizedBook
    .replace(/\[\[?|\]\]?/g, " ")
    .split(/[\s\[\]()_,.-]+/)
    .filter((t) => t.length >= 2 && !/^\d{4}$/.test(t));

  const matched = tokens.filter((token) => normalizedUser.includes(token));
  return matched.length >= Math.min(2, tokens.length);
}

function findBucketsMatchingUserQuery(
  buckets: Map<string, HotspotBucket>,
  userText: string
): Array<[string, HotspotBucket]> {
  const page = extractPageFromUserText(userText);
  const question = extractQuestionFromUserText(userText);
  const hasLocationHint = page !== null || question !== null;

  const matches: Array<[string, HotspotBucket]> = [];

  for (const [key, bucket] of buckets) {
    const parsed = parseHotspotKey(key);
    if (!parsed) continue;

    const pageMatch = page === null || Number(parsed.page) === page;
    const questionMatch = question === null || Number(parsed.question) === question;
    const bookMatch = bookNameMatchesUserQuery(bucket.bookName, userText);

    if (hasLocationHint) {
      if (pageMatch && questionMatch && (bookMatch || (page !== null && question !== null && !/[a-z가-힣]{3,}/i.test(userText.replace(/\d+/g, ""))))) {
        matches.push([key, bucket]);
      }
    } else if (bookMatch && bucket.bookName) {
      matches.push([key, bucket]);
    }
  }

  return matches.sort((a, b) => b[1].count - a[1].count);
}

/**
 * 사용자가 특정 교재 위치를 물었을 때, 해당 위치의 전체 Q&A 본문을 종합합니다.
 */
export function buildTextbookWhyDigestFromUserQuery(
  rows: Record<string, unknown>[],
  headers: string[] | undefined,
  userText: string
): string | null {
  const text = userText.trim();
  if (!text) return null;

  const page = extractPageFromUserText(text);
  const question = extractQuestionFromUserText(text);
  const buckets = buildTextbookHotspotBuckets(rows, headers);
  const matches = findBucketsMatchingUserQuery(buckets, text);
  if (matches.length === 0) return null;

  const shouldDigest =
    page !== null ||
    question !== null ||
    /(왜|이유|원인|막히|분석|많이|핫스팟|본문|질문\s*유형)/i.test(text);
  if (!shouldDigest) return null;

  const maxLocationChars = getLocationDigestChars();
  const parts = [
    "### 사용자 질의 교재 위치 — 질문 본문 종합 (왜 분석용)",
    "",
    "사용자가 언급한 교재 위치와 일치하는 질문의 **전체 본문**입니다. '왜 질문이 많았는지' 분석 시 이 섹션을 우선 사용하세요.",
    "",
  ];

  for (const [key, bucket] of matches.slice(0, 5)) {
    parts.push(
      ...formatPostsDigest(bucket, key, maxLocationChars, formatTextbookLocationLabel)
    );
  }

  if (matches.length > 5) {
    parts.push(`… 외 ${matches.length - 5}개 위치도 일치하지만 생략했습니다.`, "");
  }

  return parts.join("\n");
}

export function buildTextbookWhyDigestsFromMessages(
  rows: Record<string, unknown>[],
  headers: string[] | undefined,
  userTexts: string[]
): string | null {
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const text of [...userTexts].reverse()) {
    const digest = buildTextbookWhyDigestFromUserQuery(rows, headers, text);
    if (!digest || seen.has(digest)) continue;
    seen.add(digest);
    parts.push(digest);
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * 전체 Q&A를 서버에서 집계해 "어디에서 질문이 많은지" 인사이트 리포트 생성.
 * 대용량 파일도 전체 행 기준으로 계산 (토큰 한도와 무관).
 */
export function buildQAInsightsReport(
  rows: Record<string, unknown>[],
  headers?: string[],
  topN = 15
): string | null {
  const textbookBuckets = buildTextbookHotspotBuckets(rows, headers);
  const lectureBuckets = buildLectureHotspotBuckets(rows, headers);
  const sessionBuckets = new Map<string, HotspotBucket>();
  let locatedRows = 0;
  let textbookRows = 0;
  let lectureRows = 0;

  for (const row of rows) {
    const analysis = analyzeRowLocations(row, headers);
    if (!analysis.primaryTextbookKey && !analysis.primaryLectureKey) continue;

    locatedRows += 1;

    if (analysis.primaryTextbookKey) {
      textbookRows += 1;
    }

    if (analysis.primaryLectureKey) {
      lectureRows += 1;
      const lec = analysis.lecture.find((l) => l.matchKey) ?? analysis.lecture[0];
      if (lec?.session) {
        addToBucket(sessionBuckets, lec.session, row, lec.raw, 1, false);
      }
    }
  }

  if (locatedRows === 0) return null;

  const parts: string[] = [
    "### Q&A 인사이트 리포트 (전체 데이터 사전 집계 — 핫스팟 분석용)",
    "",
    `총 ${rows.length.toLocaleString()}행 중 위치 정보가 있는 질문 ${locatedRows.toLocaleString()}건`,
    `- 교재 위치 지정: ${textbookRows.toLocaleString()}건`,
    `- 강의 위치 지정: ${lectureRows.toLocaleString()}건`,
    "",
    "**이 리포트는 전체 Q&A를 서버에서 집계한 것입니다.**",
    "- '어느 위치에 질문이 많은지' 순위·건수는 **아래 순위표의 '질문 수' 열만** 사용하세요.",
    "- '왜 질문이 많은지' 분석은 **'질문 본문 종합' 섹션의 전체 본문**을 읽고 패턴을 도출하세요.",
    "- **강의는 '차시별 질문 수'가 아니라 '강의 핫스팟(차시+구간+동영상 구간)' 순위표**로 어느 구간인지 판단하세요.",
    `- 동영상 핫스팟은 영상을 **${DEFAULT_LECTURE_HOTSPOT_SEGMENT_MINUTES}분 고정 구간**으로 나눈 집계입니다 (예: 00:00:00~00:09:59, 00:10:00~00:19:59).`,
    `- 특정 시각 why 분석은 질문 시각 ±${DEFAULT_LECTURE_TIME_TOLERANCE_MINUTES}분이며, **00:00:00 이전으로는 내려가지 않습니다.**`,
    "- 상세 행 JSON이나 '질문 예시'만으로 why 분석·건수 집계를 하지 마세요.",
    "- 동일 건수는 같은 순위(공동 순위)로 표기하세요.",
  ];

  parts.push(
    ...formatHotspotSummaryTable(
      "교재 핫스팟 — 질문이 많은 교재·페이지·문항 TOP",
      textbookBuckets,
      topN
    )
  );
  parts.push(
    ...formatHotspotList(
      "교재 핫스팟 — 질문이 많은 교재·페이지·문항 TOP",
      textbookBuckets,
      topN
    )
  );
  parts.push(
    ...formatHotspotBodyDigest(
      "교재 핫스팟 — 질문이 많은 교재·페이지·문항 TOP",
      textbookBuckets,
      topN,
      "textbook"
    )
  );
  parts.push(
    ...formatLectureHotspotSummaryTable(
      "강의 핫스팟 — 질문이 많은 차시·동영상 구간 TOP",
      lectureBuckets,
      topN
    )
  );
  parts.push(
    ...formatHotspotList(
      "강의 핫스팟 — 질문이 많은 차시·동영상 구간 TOP",
      lectureBuckets,
      topN,
      "lecture"
    )
  );
  parts.push(
    ...formatHotspotBodyDigest(
      "강의 핫스팟 — 질문이 많은 차시·동영상 구간 TOP",
      lectureBuckets,
      topN,
      "lecture"
    )
  );
  parts.push(
    "",
    "#### 차시별 질문 수 — 참고용 (동영상 구간 핫스팟이 아님)",
    "",
    "아래는 **차시 단위** 집계입니다. '어느 동영상 구간에서 막혔는지'는 위 **강의 핫스팟 순위표(차시+구간+동영상 위치)** 를 사용하세요.",
  );
  parts.push(
    ...formatSessionHotspotSummaryTable(
      "차시별 질문 수 — 어느 차시에 질문이 몰렸는지 (참고)",
      sessionBuckets,
      10
    )
  );
  parts.push(
    ...formatHotspotList(
      "차시별 질문 수 — 어느 차시에 질문이 몰렸는지 (참고)",
      sessionBuckets,
      10,
      "session"
    )
  );

  return parts.join("\n");
}

export function buildLocationIndexSummary(
  rows: Record<string, unknown>[],
  headers?: string[]
): string | null {
  return buildQAInsightsReport(rows, headers, 20);
}

export function sheetLooksLikeQA(headers: string[], rows: Record<string, unknown>[]): boolean {
  const { textbookColumns, lectureColumns } = findQALocationColumns(headers);
  if (textbookColumns.length > 0 || lectureColumns.length > 0) return true;

  const headerText = headers.join(" ");
  if (/게시판|커뮤니티|댓글내용|조회수|추천수/.test(headerText)) return false;

  const headerTextLower = headerText.toLowerCase();
  return /q\s*&\s*a|질문|문의|답변/.test(headerTextLower) && /본문/.test(headerTextLower);
}
