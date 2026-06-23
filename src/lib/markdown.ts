/** AI 응답 마크다운을 렌더러가 파싱하기 쉽게 정규화합니다. */

import { normalizeMarkdownTables } from "@/lib/markdown-tables";

const UNICODE_ASTERISK = /[\uFF0A\u2217\u204E]/g;
const UNICODE_UNDERSCORE = /\uFF3F/g;

const LATEX_INLINE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\$\\rightarrow\$/g, "→"],
  [/\$\\Rightarrow\$/g, "⇒"],
  [/\$\\leftarrow\$/g, "←"],
  [/\$\\leftrightarrow\$/g, "↔"],
  [/\$\\cdot\$/g, "·"],
  [/\$\\times\$/g, "×"],
  [/\$\\leq\$/g, "≤"],
  [/\$\\geq\$/g, "≥"],
  [/\$\\neq\$/g, "≠"],
  [/\$\\approx\$/g, "≈"],
  [/\$\\pm\$/g, "±"],
];

const LATEX_BARE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\\rightarrow\b/g, "→"],
  [/\\Rightarrow\b/g, "⇒"],
  [/\\leftarrow\b/g, "←"],
  [/\\leftrightarrow\b/g, "↔"],
  [/\\cdot\b/g, "·"],
  [/\\times\b/g, "×"],
  [/\\leq\b/g, "≤"],
  [/\\geq\b/g, "≥"],
  [/\\neq\b/g, "≠"],
  [/\\approx\b/g, "≈"],
  [/\\pm\b/g, "±"],
];

const QUOTE_CHARS = `[\u2018\u2019\u201A\u201B\u0022\u0027\u0060\u00B4\u201C\u201D\uFF02『「』」]`;

const MARKDOWN_BODY_HINT =
  /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|\|.+\||>\s|---\s*$)/m;

const JSON_TEXT_FIELDS = ["summary", "answer", "content", "text", "response", "message"] as const;

function extractJsonTextField(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const key of JSON_TEXT_FIELDS) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    for (const key of JSON_TEXT_FIELDS) {
      const match = trimmed.match(
        new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "s")
      );
      if (match?.[1]) {
        return match[1]
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\")
          .trim();
      }
    }
  }

  return null;
}

function unwrapSingleCodeFence(text: string): string | null {
  const match = text.trim().match(/^```([^\n`]*)\n?([\s\S]*?)\n?```\s*$/);
  if (!match) return null;

  const language = match[1].trim().toLowerCase();
  let inner = match[2].trim();
  if (!inner) return "";

  if (
    language === "json" ||
    language === "jsonc" ||
    inner.startsWith("{") ||
    /"classification"\s*:/.test(inner)
  ) {
    return extractJsonTextField(inner) ?? inner;
  }

  return inner;
}

/**
 * AI가 답변 전체를 ``` 코드블록이나 JSON으로 감싸면 GFM 파서가 HTML로 변환하지 못합니다.
 * 본문 마크다운만 추출합니다.
 */
function unwrapAssistantCodeFences(text: string): string {
  let result = text.trim();

  const fullFence = unwrapSingleCodeFence(result);
  if (fullFence !== null) return fullFence;

  const introFence = result.match(/^([\s\S]*?)\n+```[^\n]*\n([\s\S]*?)\n```\s*$/);
  if (introFence) {
    const intro = introFence[1].trim();
    const body = introFence[2].trim();
    if (MARKDOWN_BODY_HINT.test(body)) {
      return intro ? `${intro}\n\n${body}` : body;
    }
  }

  if (result.startsWith("{") && /"classification"\s*:/.test(result)) {
    return extractJsonTextField(result) ?? result;
  }

  return text;
}

function normalizeAsterisks(text: string): string {
  return text.replace(UNICODE_ASTERISK, "*").replace(UNICODE_UNDERSCORE, "_");
}

/** ** text ** 처럼 강조 기호 안쪽·바깥 공백이 있으면 CommonMark가 볼드를 인식하지 못합니다. */
function tightenEmphasisMarkers(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      let result = line;
      result = result.replace(/\*\*[ \t]+/g, "**");
      result = result.replace(/[ \t]+\*\*/g, "**");
      result = result.replace(/(?<!\*)\*(?!\*)[ \t]+/g, "*");
      result = result.replace(/[ \t]+(?<!\*)\*(?!\*)/g, "*");
      return result;
    })
    .join("\n");
}

/** 따옴표가 볼드 바깥에 있는 경우: "**단 것**" → **단 것** */
function normalizeBoldOutsideQuotes(text: string): string {
  const quoteGroup = QUOTE_CHARS;
  const outsideQuotes = new RegExp(
    `${quoteGroup}\\s*\\*\\*(.+?)\\*\\*\\s*${quoteGroup}`,
    "g"
  );
  return text.replace(outsideQuotes, "**$1**");
}

function unescapeMarkdown(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!~>|])/g, "$1");
}

function replaceLatexSymbols(text: string): string {
  let result = text;
  for (const [pattern, replacement] of LATEX_INLINE_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of LATEX_BARE_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** **'제목'**, **「제목」**, **"제목"** 등 따옴표 때문에 볼드가 깨지는 패턴을 **제목**으로 정리 */
function normalizeQuotedBold(text: string): string {
  const quoteGroup = QUOTE_CHARS;
  const boldWithQuotes = new RegExp(
    `\\*\\*\\s*${quoteGroup}(.+?)${quoteGroup}\\s*\\*\\*`,
    "g"
  );
  return text.replace(boldWithQuotes, "**$1**");
}

/** *'제목'* 형태 이탤릭도 동일하게 정리 */
function normalizeQuotedItalic(text: string): string {
  const quoteGroup = QUOTE_CHARS;
  const italicWithQuotes = new RegExp(
    `(?<!\\*)\\*(?!\\*)\\s*${quoteGroup}(.+?)${quoteGroup}\\s*\\*(?!\\*)`,
    "g"
  );
  return text.replace(italicWithQuotes, "*$1*");
}

/** ~~'텍스트'~~ 취소선 따옴표 정리 */
function normalizeQuotedStrikethrough(text: string): string {
  const quoteGroup = QUOTE_CHARS;
  const strikeWithQuotes = new RegExp(
    `~~\\s*${quoteGroup}(.+?)${quoteGroup}\\s*~~`,
    "g"
  );
  return text.replace(strikeWithQuotes, "~~$1~~");
}

/**
 * 문장 중간 *항목명: 내용 형태(가짜 불릿)를 마크다운 리스트로 변환합니다.
 * 예: "...합니다. *모의고사: 내용" → "...합니다.\n\n- **모의고사:** 내용"
 */
function normalizeInlineAsteriskBullets(text: string): string {
  let result = text;

  result = result.replace(
    /([.!?。])\s*\*([^*\n]+?):/g,
    "$1\n\n- **$2:**"
  );

  result = result.replace(
    /(?<=^|\n)\*([^*\n]+?):/g,
    "- **$1:**"
  );

  result = result.replace(
    /(?<!\*)\s+\*([^*\n]+?):/g,
    "\n- **$1:**"
  );

  return result;
}

/** 핫스팟 분석 답변의 섹션 라벨·불릿 구조를 정리합니다. */
function normalizeAnalysisSections(text: string): string {
  let result = text;

  result = result.replace(
    /왜 이 위치에서 질문이 몰렸는가\s*\(Why\)\s*/g,
    "**왜 질문이 몰렸는가**\n\n"
  );

  result = result.replace(
    /강사 액션 제안(?!\*\*)\s*/g,
    "**강사 액션 제안**\n\n"
  );

  result = result.replace(
    /([.!?。])\s+(?=\d+\.\s*\[\[)/g,
    "$1\n\n"
  );

  result = result.replace(
    /(질문 수:\s*\d+건\))\s*(?=\*\*|왜|강사|[가-힣])/g,
    "$1\n\n"
  );

  result = result.replace(
    /\*\*강사 액션 제안\*\*\s*-\s*/g,
    "**강사 액션 제안**\n\n- "
  );

  result = result.replace(
    /\*\*왜 질문이 몰렸는가\*\*\s*-\s*/g,
    "**왜 질문이 몰렸는가**\n\n- "
  );

  return result;
}

/** 한글과 볼드 기호가 붙은 패턴 분리: 학생들은**[1번] → 학생들은 **[1번] */
function normalizeKoreanBoldGlue(text: string): string {
  return text
    .replace(/([가-힣])(\*\*)/g, "$1 $2")
    .replace(/(\*\*[^*\n]+?\*\*)([가-힣\[])/g, "$1 $2")
    .replace(/  \*\*/g, " **");
}

/**
 * AI가 *** 를 불릿처럼 쓰는 잘못된 패턴을 GFM 불릿(-)으로 변환합니다.
 */
function normalizeTripleAsteriskBullets(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (!/\*{3}/.test(line)) return line;

      const hadHr = /\*\*---\s*$/.test(line);
      let cleaned = line.replace(/\*\*---\s*$/, "");

      const items = cleaned
        .split(/\*{3,}/)
        .map((segment) => segment.trim())
        .filter(Boolean);

      if (items.length === 0) return hadHr ? "---" : line;

      const bullets = items.map((item) => {
        let body = item.replace(/\*+$/g, "").trim();
        const noteMatch = body.match(/(\([^)]*\))\s*$/);
        const note = noteMatch?.[1] ?? "";
        if (note) body = body.slice(0, -note.length).trim();

        body = body.replace(/\*\*/g, "").replace(/\s+등\s*$/g, " 등").trim();

        const colonMatch = body.match(/^([^:]+):\s*(.+)$/);
        if (colonMatch && colonMatch[1].length <= 40) {
          const label = colonMatch[1].trim().replace(/\*+/g, "");
          const names = colonMatch[2].replace(/\s*,\s*/g, ", ").replace(/\*+/g, "").trim();
          return `- **${label}**: ${names}${note ? ` ${note}` : ""}`;
        }

        return `- **${body}**${note ? ` ${note}` : ""}`;
      });

      let result = bullets.join("\n");
      if (hadHr) result += "\n\n---";
      return result;
    })
    .join("\n");
}

function normalizeHorizontalRules(text: string): string {
  return text
    .replace(/\*\*---/g, "**\n\n---")
    .replace(/^---\*\*/gm, "---\n\n**")
    .replace(/---\*\*/g, "---\n\n**")
    .replace(/---\s*([가-힣])/g, "---\n\n$1");
}

function normalizeNumberedSectionHeaders(text: string): string {
  const sectionKeyword =
    /(?:주요|구성|출처|언급|분석|요약|영역|플랫폼|커뮤니티|핫스팟|TOP|정리|데이터|강사|라인업)/;

  return text
    .split("\n")
    .map((line) => {
      if (line.startsWith("#")) return line;
      const match = line.match(/^(\d+)\.\s+(.+)$/);
      if (!match) return line;

      const title = match[2].trim();
      const isSectionTitle =
        title.length <= 50 && !title.endsWith(".") && sectionKeyword.test(title);

      return isSectionTitle ? `### ${match[1]}. ${title}` : line;
    })
    .join("\n");
}

function normalizePunctuationBoldSpacing(text: string): string {
  return text
    .replace(/([,.;:])(\*\*)/g, "$1 $2")
    .replace(/(\*\*)([,.;:])/g, "$1$2");
}

function ensureListSpacing(text: string): string {
  return text.replace(/^-(\*\*)/gm, "- $1");
}

function cleanBrokenBold(text: string): string {
  return text.replace(/\*\*([^*\n]+?)\*\*/g, (_, inner) => `**${inner.trim()}**`);
}

function finalizeMarkdown(text: string): string {
  let result = tightenEmphasisMarkers(text);
  result = cleanBrokenBold(result);
  result = result.replace(/\*\*\s*\(/g, "** (");
  return ensureListSpacing(result);
}

export function preprocessAssistantMarkdown(content: string): string {
  if (!content) return "";

  let text = content.replace(/\r\n/g, "\n");
  text = unwrapAssistantCodeFences(text);
  text = normalizeAsterisks(text);
  text = unescapeMarkdown(text);
  text = replaceLatexSymbols(text);
  text = normalizeTripleAsteriskBullets(text);
  text = normalizeHorizontalRules(text);
  text = tightenEmphasisMarkers(text);
  text = normalizeInlineAsteriskBullets(text);
  text = normalizeBoldOutsideQuotes(text);
  text = normalizeQuotedBold(text);
  text = normalizeQuotedItalic(text);
  text = normalizeQuotedStrikethrough(text);
  text = normalizeAnalysisSections(text);
  text = normalizeNumberedSectionHeaders(text);
  text = normalizePunctuationBoldSpacing(text);
  text = cleanBrokenBold(text);
  text = normalizeKoreanBoldGlue(text);
  text = ensureListSpacing(text);
  text = normalizeHorizontalRules(text);
  text = normalizeMarkdownTables(text);
  text = finalizeMarkdown(text);

  return text;
}
