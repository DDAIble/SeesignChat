import { withBasePath } from "@/lib/base-path";
import { consumeNdjsonStream } from "@/lib/ndjson-stream";
import { progressFromServerEvent } from "@/lib/learning-progress";
import { readJsonResponse } from "@/lib/fetch-json";
import {
  UploadFileError,
  uploadSizeError,
  uploadTooLargeError,
  wrapUploadError,
} from "@/lib/upload-errors";
import type { UploadLimits } from "@/lib/upload-limits";
import type { ExcelData } from "@/lib/types";

async function consumeUploadStream(
  res: Response,
  fileName: string,
  maxFileBytes: number,
  onAdd: (data: ExcelData) => void,
  onUpdate: (id: string, patch: Partial<ExcelData>) => void
): Promise<void> {
  const contentType = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    if (res.status === 413) {
      throw uploadTooLargeError(fileName, maxFileBytes);
    }
    const json = await readJsonResponse<{ error?: string }>(res).catch(() => ({
      error: "업로드 실패",
    }));
    const message = json.error || "업로드 실패";
    if (/413|too large|payload|용량|커서/i.test(message)) {
      throw uploadTooLargeError(fileName, maxFileBytes);
    }
    throw new Error(message);
  }

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

  let uploadedData: ExcelData | null = null;
  let uploadedFileId: string | null = null;
  let failureMessage: string | null = null;

  await consumeNdjsonStream(res, (event) => {
    if (event.type === "error") {
      failureMessage = String(event.message ?? "파일 학습에 실패했습니다.");
      return;
    }

    if (event.type === "uploaded") {
      uploadedData = event.data as ExcelData;
      uploadedFileId = uploadedData.id;
      onAdd({
        ...uploadedData,
        indexStatus: "indexing",
        indexProgress: { phase: "chunk", percent: 2 },
      });
      return;
    }

    if (!uploadedData) return;

    if (event.type === "progress") {
      const mapped = progressFromServerEvent({
        phase: event.phase as "chunk" | "embed" | "done",
        completed: Number(event.completed ?? 0),
        total: Number(event.total ?? 1),
        chunkCount: Number(event.chunkCount ?? 0),
      });
      onUpdate(uploadedData.id, {
        indexStatus: "indexing",
        indexProgress: mapped,
      });
      return;
    }

    if (event.type === "done") {
      onUpdate(uploadedData.id, {
        indexStatus: "ready",
        indexedChunks: Number(event.chunkCount ?? 0),
        indexError: undefined,
        indexProgress: { phase: "done", percent: 100 },
      });
    }
  });

  if (failureMessage) {
    if (uploadedFileId) {
      onUpdate(uploadedFileId, {
        indexStatus: "error",
        indexError: failureMessage,
        indexProgress: undefined,
      });
    }
    throw wrapUploadError(fileName, new Error(failureMessage), maxFileBytes);
  }
  if (!uploadedData) {
    throw new UploadFileError(fileName, "server", "업로드 응답이 비어 있습니다.");
  }
}

export async function uploadAndIndexFile(
  file: File,
  onAdd: (data: ExcelData) => void,
  onUpdate: (id: string, patch: Partial<ExcelData>) => void,
  limits: UploadLimits
): Promise<void> {
  if (file.size > limits.maxFileBytes) {
    throw uploadSizeError(file.name, file.size, limits.maxFileBytes);
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new UploadFileError(
      file.name,
      "locked",
      "현재 데스크탑(엑셀 등)에서 이 파일을 실행 중인 것 같습니다. 실행 중인 파일을 닫은 뒤 다시 업로드해 주세요."
    );
  }

  const formData = new FormData();
  formData.append("file", new Blob([buffer], { type: file.type }), file.name);

  try {
    const res = await fetch(withBasePath("/api/upload"), {
      method: "POST",
      body: formData,
    });
    await consumeUploadStream(res, file.name, limits.maxFileBytes, onAdd, onUpdate);
  } catch (error) {
    throw wrapUploadError(file.name, error, limits.maxFileBytes);
  }
}
