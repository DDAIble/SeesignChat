import { withBasePath } from "@/lib/base-path";
import { consumeNdjsonStream } from "@/lib/ndjson-stream";
import { progressFromServerEvent } from "@/lib/learning-progress";
import { readJsonResponse } from "@/lib/fetch-json";
import type { ExcelData } from "@/lib/types";

/** 데스크탑(엑셀 등)에서 파일을 열어둬 잠긴 경우 안내 문구 */
const FILE_IN_USE_MESSAGE =
  "현재 데스크탑(엑셀 등)에서 이 파일을 실행 중인 것 같습니다. 실행 중인 파일을 닫은 뒤 다시 업로드해 주세요.";

export async function uploadAndIndexFile(
  file: File,
  onAdd: (data: ExcelData) => void,
  onUpdate: (id: string, patch: Partial<ExcelData>) => void
): Promise<void> {
  // 업로드 전 파일을 먼저 읽어 잠김(다른 프로그램에서 사용 중)을 감지합니다.
  // Windows에서 엑셀 등으로 파일을 열어두면 여기서 읽기가 실패하거나, 전송 중 fetch가 "Failed to fetch"로 끊깁니다.
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new Error(FILE_IN_USE_MESSAGE);
  }

  const formData = new FormData();
  // 읽어둔 메모리 복사본을 전송해 전송 도중 파일 잠김으로 인한 오류를 방지합니다.
  formData.append("file", new Blob([buffer], { type: file.type }), file.name);

  let res: Response;
  try {
    res = await fetch(withBasePath("/api/upload"), {
      method: "POST",
      body: formData,
    });
  } catch {
    // fetch가 TypeError("Failed to fetch")로 실패 — 파일 잠김 또는 네트워크 문제
    throw new Error(FILE_IN_USE_MESSAGE);
  }

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
