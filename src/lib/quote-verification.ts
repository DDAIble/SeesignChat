const MIN_QUOTE_LENGTH = 10;

const BLOCKQUOTE_RE = /^>\s*(.+)$/gm;
const DOUBLE_QUOTE_RE = /"([^"]{10,})"/g;
const SINGLE_QUOTE_RE = /'([^']{10,})'/g;
const KOREAN_QUOTE_RE = /[「『""]([^」』""]{10,})[」』""]/g;

export interface QuoteVerificationResult {
  passed: boolean;
  failedQuotes: string[];
  checkedQuotes: string[];
  corpusSize: number;
}

export function normalizeQuoteText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function extractQuoteCandidates(content: string): string[] {
  const candidates: string[] = [];

  for (const match of content.matchAll(BLOCKQUOTE_RE)) {
    if (match[1]) candidates.push(match[1]);
  }
  for (const match of content.matchAll(DOUBLE_QUOTE_RE)) {
    if (match[1]) candidates.push(match[1]);
  }
  for (const match of content.matchAll(SINGLE_QUOTE_RE)) {
    if (match[1]) candidates.push(match[1]);
  }
  for (const match of content.matchAll(KOREAN_QUOTE_RE)) {
    if (match[1]) candidates.push(match[1]);
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeQuoteText(candidate);
    if (normalized.length < MIN_QUOTE_LENGTH) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
  }

  return unique;
}

function quoteExistsInCorpus(quote: string, normalizedCorpus: string): boolean {
  const normalizedQuote = normalizeQuoteText(quote).toLowerCase();
  if (!normalizedQuote) return true;
  return normalizedCorpus.includes(normalizedQuote);
}

export function verifyQuotesInAnswer(
  answer: string,
  corpus: string[]
): QuoteVerificationResult {
  const checkedQuotes = extractQuoteCandidates(answer);
  if (checkedQuotes.length === 0) {
    return { passed: true, failedQuotes: [], checkedQuotes: [], corpusSize: corpus.length };
  }

  const normalizedCorpus = normalizeQuoteText(corpus.join("\n")).toLowerCase();
  const failedQuotes = checkedQuotes.filter(
    (quote) => !quoteExistsInCorpus(quote, normalizedCorpus)
  );

  return {
    passed: failedQuotes.length === 0,
    failedQuotes,
    checkedQuotes,
    corpusSize: corpus.length,
  };
}

export const QUOTE_DISCLAIMER =
  "> **안내**: 아래 답변 중 일부 문장은 업로드 데이터 원문과 일치하지 않을 수 있으며, 맥락을 바탕으로 AI가 생성한 내용입니다.\n\n";

export const VERBATIM_RETRY_SUFFIX = `

## 원문 인용 재시도 — 반드시 준수
- **답변 본문은 한국어(한글)로만 작성**하세요. 베트남어·영어 등 다른 언어 본문 금지.
- 이전 답변의 인용문 중 데이터 원문과 일치하지 않는 문장이 있었습니다.
- **인용 가능 원문** 섹션에 있는 **제목·본문을 글자 그대로** 복사하세요.
- 원문에 없는 문장은 생성·요약·의역하지 마세요.
- 인용할 원문이 없으면 "해당 조건의 원문을 데이터에서 찾지 못했습니다"라고만 답하세요.
`;

const MIN_PARAPHRASE_LENGTH = 40;
const EVIDENCE_MARKER_RE =
  /(\[근거\s*\d+\s*[:：]|(\[근거\s*\d+\])|#evidence-|출처\s*\d+\s*건|\[출처)/;

export interface SummaryClaimVerificationResult {
  passed: boolean;
  missingEvidenceBullets: number;
  missingAiSummaryLabels: number;
  unverifiedQuotes: string[];
}

/** 요약 답변: 불릿마다 근거 태그·출처 버튼 표기 검사 */
export function verifySummaryClaims(answer: string, corpus: string[]): SummaryClaimVerificationResult {
  const quoteResult = verifyQuotesInAnswer(answer, corpus);

  const lines = answer.split("\n");
  let missingEvidenceBullets = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-") && !trimmed.startsWith("*")) continue;
    const content = trimmed.replace(/^[-*]\s+/, "");
    if (content.length < MIN_PARAPHRASE_LENGTH) continue;
    if (EVIDENCE_MARKER_RE.test(content)) continue;

    missingEvidenceBullets++;
  }

  return {
    passed: quoteResult.passed && missingEvidenceBullets === 0,
    missingEvidenceBullets,
    missingAiSummaryLabels: 0,
    unverifiedQuotes: quoteResult.failedQuotes,
  };
}

export const SUMMARY_CLAIM_DISCLAIMER =
  "> **안내**: 아래 답변 일부 불릿에 `[근거 N]` 출처 표기가 누락되었거나, 데이터 원문과 일치하지 않는 서술이 포함될 수 있습니다. 출처가 필요하면 **[출처 N건]** 버튼 또는 해당 문장을 다시 질문해 주세요.\n\n";
