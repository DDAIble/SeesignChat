import type { ExcelData } from "@/lib/types";
import { progressFromServerEvent } from "@/lib/learning-progress";

const MAX_CONCURRENT_FILE_INDEX = 2;

type IndexJob = {
  data: ExcelData;
  onUpdate: (id: string, patch: Partial<ExcelData>) => void;
};

const queue: IndexJob[] = [];
let running = 0;

async function consumeNdjsonStream(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("학습 응답 스트림을 읽을 수 없습니다.");
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
      const trimmed = line.trim();
      if (!trimmed) continue;
      onEvent(JSON.parse(trimmed) as Record<string, unknown>);
    }
  }

  const tail = buffer.trim();
  if (tail) {
    onEvent(JSON.parse(tail) as Record<string, unknown>);
  }
}

async function runIndexJob(job: IndexJob): Promise<void> {
  const { data, onUpdate } = job;

  onUpdate(data.id, {
    indexStatus: "indexing",
    indexProgress: { phase: "chunk", percent: 4 },
  });

  try {
    const embedRes = await fetch("/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });

    const contentType = embedRes.headers.get("content-type") ?? "";

    if (!embedRes.ok) {
      const embedJson = await embedRes.json().catch(() => ({}));
      throw new Error(
        (embedJson as { error?: string }).error || "파일 학습에 실패했습니다."
      );
    }

    if (!contentType.includes("ndjson")) {
      const embedJson = (await embedRes.json()) as { chunkCount?: number };
      onUpdate(data.id, {
        indexStatus: "ready",
        indexedChunks: embedJson.chunkCount ?? 0,
        indexError: undefined,
        indexProgress: { phase: "done", percent: 100 },
      });
      return;
    }

    let chunkCount = 0;
    let skipped = false;

    await consumeNdjsonStream(embedRes, (event) => {
      if (event.type === "progress") {
        const mapped = progressFromServerEvent({
          phase: event.phase as "chunk" | "embed" | "done",
          completed: Number(event.completed ?? 0),
          total: Number(event.total ?? 1),
          chunkCount: Number(event.chunkCount ?? 0),
        });
        onUpdate(data.id, {
          indexStatus: "indexing",
          indexProgress: mapped,
        });
        return;
      }

      if (event.type === "done") {
        chunkCount = Number(event.chunkCount ?? 0);
        skipped = Boolean(event.skipped);
        return;
      }

      if (event.type === "error") {
        throw new Error(String(event.message ?? "파일 학습에 실패했습니다."));
      }
    });

    onUpdate(data.id, {
      indexStatus: "ready",
      indexedChunks: chunkCount,
      indexError: undefined,
      indexProgress: { phase: "done", percent: 100 },
    });

    if (skipped) {
      onUpdate(data.id, { indexedChunks: chunkCount });
    }
  } catch (err) {
    onUpdate(data.id, {
      indexStatus: "error",
      indexError: err instanceof Error ? err.message : "파일 학습 중 오류가 발생했습니다.",
      indexProgress: undefined,
    });
  }
}

function pumpQueue(): void {
  while (running < MAX_CONCURRENT_FILE_INDEX && queue.length > 0) {
    const job = queue.shift();
    if (!job) break;
    running += 1;
    void runIndexJob(job).finally(() => {
      running -= 1;
      pumpQueue();
    });
  }
}

export function enqueueFileIndex(
  data: ExcelData,
  onUpdate: (id: string, patch: Partial<ExcelData>) => void
): void {
  onUpdate(data.id, {
    indexStatus: "indexing",
    indexProgress: { phase: "chunk", percent: 2 },
  });
  queue.push({ data, onUpdate });
  pumpQueue();
}
