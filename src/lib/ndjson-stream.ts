export async function consumeNdjsonStream(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("응답 스트림을 읽을 수 없습니다.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      parseNdjsonLine(line, onEvent);
    }
  }

  const tail = buffer.trim();
  if (tail) {
    parseNdjsonLine(tail, onEvent);
  }
}

function parseNdjsonLine(
  line: string,
  onEvent: (event: Record<string, unknown>) => void
): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  if (trimmed.startsWith("<") || trimmed.startsWith("Server ")) {
    throw new Error("API가 비정상 응답을 반환했습니다. 개발 서버를 재시작해 주세요.");
  }

  try {
    onEvent(JSON.parse(trimmed) as Record<string, unknown>);
  } catch {
    throw new Error(`응답을 해석하지 못했습니다: ${trimmed.slice(0, 80)}`);
  }
}
