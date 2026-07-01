import { withBasePath } from "@/lib/base-path";
import { consumeNdjsonStream } from "@/lib/ndjson-stream";
import { progressFromServerEvent } from "@/lib/learning-progress";
import { readJsonResponse } from "@/lib/fetch-json";
import { parseExcelBuffer } from "@/lib/parse-excel";
import {
  UploadFileError,
  uploadSizeError,
  validateParsedDataForUpload,
  wrapUploadError,
} from "@/lib/upload-errors";
import {
  getClientChunkUploadThresholdBytes,
  type UploadLimits,
} from "@/lib/upload-limits";
import type { ExcelData } from "@/lib/types";

/** Vercel API 요청 한도(4.5MB) 이하만 원본 파일을 직접 POST — 그 이상은 브라우저 파싱·청크 전송 */
const CLIENT_CHUNK_THRESHOLD = getClientChunkUploadThresholdBytes();
const ROWS_PER_CHUNK = 200;

async function postUploadJson(body: Record<string, unknown>): Promise<void> {
  const res = await fetch(withBasePath("/api/upload"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await readJsonResponse<{ error?: string }>(res).catch(() => ({
      error: "업로드 실패",
    }));
    throw new Error(json.error || "업로드 실패");
  }
}

async function uploadParsedInChunks(data: ExcelData): Promise<Response> {
  await postUploadJson({
    action: "prepare",
    id: data.id,
    fileName: data.fileName,
    uploadedAt: data.uploadedAt,
    sheets: data.sheets.map((sheet) => ({
      name: sheet.name,
      headers: sheet.headers,
      rowCount: sheet.rowCount,
    })),
  });

  for (const sheet of data.sheets) {
    for (let offset = 0; offset < sheet.rows.length; offset += ROWS_PER_CHUNK) {
      const rows = sheet.rows.slice(offset, offset + ROWS_PER_CHUNK);
      await postUploadJson({
        action: "chunk",
        uploadId: data.id,
        sheetName: sheet.name,
        rows,
      });
    }
  }

  try {
    return await fetch(withBasePath("/api/upload"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete", uploadId: data.id }),
    });
  } catch {
    throw new UploadFileError(
      data.fileName,
      "locked",
      "현재 데스크탑(엑셀 등)에서 이 파일을 실행 중이거나 네트워크가 끊긴 것 같습니다. 파일을 닫은 뒤 다시 업로드해 주세요."
    );
  }
}

async function consumeUploadStream(
  res: Response,
  fileName: string,
  onAdd: (data: ExcelData) => void,
  onUpdate: (id: string, patch: Partial<ExcelData>) => void
): Promise<void> {
  const contentType = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    const json = await readJsonResponse<{ error?: string }>(res).catch(() => ({
      error:
        res.status === 413
          ? "서버 전송 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."
          : "업로드 실패",
    }));
    throw new Error(json.error || "업로드 실패");
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
    throw wrapUploadError(fileName, new Error(failureMessage));
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

  try {
    let res: Response;

    if (file.size > CLIENT_CHUNK_THRESHOLD) {
      let data: ExcelData;
      try {
        data = parseExcelBuffer(buffer, file.name);
      } catch {
        throw new UploadFileError(
          file.name,
          "format",
          "파일을 읽을 수 없습니다. 손상되었거나 지원하지 않는 형식일 수 있습니다."
        );
      }

      const validationError = validateParsedDataForUpload(data);
      if (validationError) throw validationError;

      res = await uploadParsedInChunks(data);
    } else {
      const formData = new FormData();
      formData.append("file", new Blob([buffer], { type: file.type }), file.name);

      try {
        res = await fetch(withBasePath("/api/upload"), {
          method: "POST",
          body: formData,
        });
      } catch {
        throw new UploadFileError(
          file.name,
          "locked",
          "현재 데스크탑(엑셀 등)에서 이 파일을 실행 중이거나 네트워크가 끊긴 것 같습니다. 파일을 닫은 뒤 다시 업로드해 주세요."
        );
      }
    }

    await consumeUploadStream(res, file.name, onAdd, onUpdate);
  } catch (error) {
    throw wrapUploadError(file.name, error);
  }
}
