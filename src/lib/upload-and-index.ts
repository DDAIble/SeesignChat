import { withBasePath } from "@/lib/base-path";
import { consumeNdjsonStream } from "@/lib/ndjson-stream";
import { progressFromServerEvent } from "@/lib/learning-progress";
import { readJsonResponse } from "@/lib/fetch-json";
import type { ExcelData } from "@/lib/types";

export async function uploadAndIndexFile(
  file: File,
  onAdd: (data: ExcelData) => void,
  onUpdate: (id: string, patch: Partial<ExcelData>) => void
): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(withBasePath("/api/upload"), {
    method: "POST",
    body: formData,
  });

  const contentType = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    const json = await readJsonResponse<{ error?: string }>(res).catch(() => ({
      error: "업로드 실패",
    }));
    throw new Error(json.error || "업로드 실패");
  }

  // 게이트웨이 프록시가 content-type을 바꿀 수 있어 JSON이 아니면 NDJSON으로 처리
  const isNdjsonStream =
    contentType.includes("ndjson") || !contentType.includes("application/json");

  if (!isNdjsonStream) {
    const json = await readJsonResponse<{ data?: ExcelData; error?: string }>(res);
    const data = json.data;
    if (!data) {
      throw new Error(json.error || "업로드 응답이 비어 있습니다.");
    }
    onAdd({ ...data, indexStatus: "ready" });
    return;
  }

  let data: ExcelData | null = null;
  let streamError: Error | null = null;

  await consumeNdjsonStream(res, (event) => {
    if (event.type === "error") {
      streamError = new Error(String(event.message ?? "파일 학습에 실패했습니다."));
      return;
    }

    if (event.type === "uploaded") {
      data = event.data as ExcelData;
      onAdd({
        ...data,
        indexStatus: "indexing",
        indexProgress: { phase: "chunk", percent: 2 },
      });
      return;
    }

    if (!data) return;

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
      onUpdate(data.id, {
        indexStatus: "ready",
        indexedChunks: Number(event.chunkCount ?? 0),
        indexError: undefined,
        indexProgress: { phase: "done", percent: 100 },
      });
      return;
    }

    if (event.type === "error") {
      const message = String(event.message ?? "파일 학습에 실패했습니다.");
      if (data) {
        onUpdate(data.id, {
          indexStatus: "error",
          indexError: message,
          indexProgress: undefined,
        });
      }
      streamError = new Error(message);
    }
  });

  if (streamError) {
    throw streamError;
  }

  if (!data) {
    throw new Error("업로드 응답이 비어 있습니다.");
  }
}
