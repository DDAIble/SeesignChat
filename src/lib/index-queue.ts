import { withBasePath } from "@/lib/base-path";
import type { ExcelData } from "@/lib/types";
import { progressFromServerEvent } from "@/lib/learning-progress";
import { readJsonResponse } from "@/lib/fetch-json";
import { consumeNdjsonStream } from "@/lib/ndjson-stream";

const MAX_CONCURRENT_FILE_INDEX = 1;
const EMBED_BODY_LIMIT_BYTES = 4_000_000;
const EMBED_RETRY_MAX = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildEmbedRequestBody(data: ExcelData): string {
  const withData = JSON.stringify({ fileId: data.id, data });
  if (withData.length < EMBED_BODY_LIMIT_BYTES) {
    return withData;
  }
  return JSON.stringify({ fileId: data.id });
}

async function requestEmbed(data: ExcelData): Promise<Response> {
  const body = buildEmbedRequestBody(data);

  for (let attempt = 0; attempt <= EMBED_RETRY_MAX; attempt++) {
    const embedRes = await fetch(withBasePath("/api/embed"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (embedRes.ok || embedRes.status === 413) {
      return embedRes;
    }

    if (embedRes.status === 404 && attempt < EMBED_RETRY_MAX) {
      await sleep(600 * (attempt + 1));
      continue;
    }

    return embedRes;
  }

  throw new Error("파일 학습에 실패했습니다.");
}

type IndexJob = {
  data: ExcelData;
  onUpdate: (id: string, patch: Partial<ExcelData>) => void;
};

const queue: IndexJob[] = [];
let running = 0;

async function runIndexJob(job: IndexJob): Promise<void> {
  const { data, onUpdate } = job;

  onUpdate(data.id, {
    indexStatus: "indexing",
    indexProgress: { phase: "chunk", percent: 4 },
  });

  try {
    const embedRes = await requestEmbed(data);

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

/** 업로드 시 학습 실패한 파일만 수동 재시도할 때 사용 */
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
