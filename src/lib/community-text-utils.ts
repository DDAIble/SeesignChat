export function getCommunityField(row: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const val = row[name];
    if (val !== undefined && val !== null && String(val).trim()) {
      return String(val).trim();
    }
  }
  return "";
}

export function getRowTitleBody(row: Record<string, unknown>): { title: string; body: string } {
  return {
    title: getCommunityField(row, "제목"),
    body: getCommunityField(row, "본문"),
  };
}

export function normalizeTextForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function rowMatchesKeyword(row: Record<string, unknown>, keyword: string): boolean {
  const normalizedKeyword = normalizeTextForMatch(keyword);
  if (!normalizedKeyword) return false;

  const { title, body } = getRowTitleBody(row);
  const haystack = normalizeTextForMatch(`${title} ${body}`);
  return haystack.includes(normalizedKeyword);
}

export function parseCommunityDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const shortMatch = raw.match(/^(\d{1,2})[-/.](\d{1,2})(?:\s|$)/);
  if (shortMatch) {
    const year = new Date().getFullYear();
    const [, m, d] = shortMatch;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  return null;
}

export function extractDateFilterFromQuery(query: string): string | null {
  const text = query.trim();

  const iso = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const short = text.match(/(\d{1,2})[-/.](\d{1,2})(?:\s|$|[^0-9])/);
  if (short) {
    const year = new Date().getFullYear();
    const [, m, d] = short;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return null;
}

export function collectKnownKeywordsFromData(
  sheets: Array<{ rows: Record<string, unknown>[] }>
): string[] {
  const counts = new Map<string, number>();
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const keyword = getCommunityField(row, "키워드");
      if (!keyword) continue;
      counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}
