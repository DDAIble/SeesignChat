import type { ExcelData } from "@/lib/types";
import { progressFromServerEvent } from "@/lib/learning-progress";
import { readJsonResponse } from "@/lib/fetch-json";

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
      if (trimmed.startsWith("<") || trimmed.startsWith("Server ")) {
        throw new Error(
          "파일 학습 API가 비정상 응답을 반환했습니다. 개발 서버를 재시작해 주세요."
        );
      }
      try {
        onEvent(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        throw new Error(
          `학습 진행 응답을 해석하지 못했습니다: ${trimmed.slice(0, 80)}`
        );
      }
    }
  }

  const tail = buffer.trim();
  if (tail) {
    if (tail.startsWith("<") || tail.startsWith("Server ")) {
      throw new Error(
        "파일 학습 API가 비정상 응답을 반환했습니다. 개발 서버를 재시작해 주세요."
      );
    }
    try {
      onEvent(JSON.parse(tail) as Record<string, unknown>);
    } catch {
      throw new Error(`학습 진행 응답을 해석하지 못했습니다: ${tail.slice(0, 80)}`);
    }
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
      body: JSON.stringify({ fileId: data.id }),
    });

    const contentType = embedRes.headers.get("content-type") ?? "";

    if (!embedRes.ok) {
      if (embedRes.status === 413) {
        throw new Error(
          "파일이 너무 커서 학습 요청 한도를 초과했습니다. 파일을 나누거나 서버 용량이 큰 환경(Cloud Run 등)으로 배포해 주세요."
        );
      }
      const embedJson = await readJsonResponse<{ error?: string }>(embedRes).catch(
        () => ({ error: "파일 학습에 실패했습니다." })
      );
      throw new Error(embedJson.error || "파일 학습에 실패했습니다.");
    }

    if (!contentType.includes("ndjson")) {
      const embedJson = await readJsonResponse<{ chunkCount?: number }>(embedRes);
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
