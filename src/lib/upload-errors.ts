import type { ExcelData } from "@/lib/types";
import { validateParsedExcelData } from "@/lib/upload-validate";

export type UploadFailReason =
  | "size"
  | "rows"
  | "sheets"
  | "empty"
  | "format"
  | "locked"
  | "server"
  | "unknown";

export class UploadFileError extends Error {
  readonly fileName: string;
  readonly reason: UploadFailReason;

  constructor(fileName: string, reason: UploadFailReason, detail: string) {
    super(`「${fileName}」 ${detail}`);
    this.name = "UploadFileError";
    this.fileName = fileName;
    this.reason = reason;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function formatMaxMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (!Number.isInteger(mb)) {
    return `${mb.toFixed(1)}MB`;
  }
  return `${mb}MB`;
}

export function uploadSizeError(
  fileName: string,
  fileBytes: number,
  maxBytes: number
): UploadFileError {
  return new UploadFileError(
    fileName,
    "size",
    `파일 용량 초과 (${formatFileSize(fileBytes)} · 최대 ${formatMaxMb(maxBytes)})`
  );
}

export function uploadTooLargeError(fileName: string, maxBytes: number): UploadFileError {
  return new UploadFileError(
    fileName,
    "size",
    `파일이 너무 큽니다. 파일당 최대 ${formatMaxMb(maxBytes)}까지 업로드할 수 있습니다.`
  );
}

export function validateParsedDataForUpload(data: ExcelData): UploadFileError | null {
  const serverMessage = validateParsedExcelData(data);
  if (!serverMessage) return null;

  if (serverMessage.includes("시트가 너무 많")) {
    return new UploadFileError(data.fileName, "sheets", serverMessage);
  }
  if (serverMessage.includes("행이 없습니다")) {
    return new UploadFileError(data.fileName, "empty", serverMessage);
  }
  return new UploadFileError(data.fileName, "unknown", serverMessage);
}

export function wrapUploadError(
  fileName: string,
  error: unknown,
  maxFileBytes?: number
): UploadFileError {
  if (error instanceof UploadFileError) return error;

  const message =
    error instanceof Error ? error.message : "업로드 중 알 수 없는 오류가 발생했습니다.";

  if (message.startsWith(`「${fileName}」`)) {
    return new UploadFileError(fileName, "unknown", message.replace(`「${fileName}」 `, ""));
  }

  if (maxFileBytes && /세션.*만료|불완전|413|payload|전송 한도|too large/i.test(message)) {
    return uploadTooLargeError(fileName, maxFileBytes);
  }

  if (/실행 중인 파일을 닫/i.test(message)) {
    return new UploadFileError(fileName, "locked", message.replace(/^「[^」]+」\s*/, ""));
  }
  if (/읽을 수 없습니다|손상|형식/i.test(message)) {
    return new UploadFileError(fileName, "format", message.replace(/^「[^」]+」\s*/, ""));
  }
  if (/행이 없습니다/.test(message)) {
    return new UploadFileError(fileName, "empty", message.replace(/^「[^」]+」\s*/, ""));
  }
  if (/용량|커서|413|MB/i.test(message)) {
    if (maxFileBytes) return uploadTooLargeError(fileName, maxFileBytes);
    return new UploadFileError(fileName, "size", message.replace(/^「[^」]+」\s*/, ""));
  }

  return new UploadFileError(fileName, "server", message.replace(/^「[^」]+」\s*/, ""));
}
