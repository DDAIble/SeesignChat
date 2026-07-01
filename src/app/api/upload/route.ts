import { NextRequest } from "next/server";
import { parseExcelBuffer } from "@/lib/parse-excel";
import { processUploadedExcelData } from "@/lib/upload-process";
import {
  appendUploadChunk,
  createUploadSession,
  discardUploadSession,
  finalizeUploadSession,
} from "@/lib/upload-session";
import { validateParsedExcelData } from "@/lib/upload-validate";
import type { ExcelData } from "@/lib/types";

export const maxDuration = 300;

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

function getPositiveEnvInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createNdjsonStream(
  run: (send: (payload: Record<string, unknown>) => void) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };
      try {
        await run(send);
      } catch (error) {
        console.error("Upload stream error:", error);
        send({
          type: "error",
          message: "파일을 처리하는 중 오류가 발생했습니다. 파일 형식과 내용을 확인해 주세요.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

async function streamProcessedData(data: ExcelData): Promise<Response> {
  const validationError = validateParsedExcelData(data);
  if (validationError) {
    return createNdjsonStream(async (send) => {
      send({ type: "error", message: validationError });
    });
  }

  return createNdjsonStream(async (send) => {
    await processUploadedExcelData(data, send);
  });
}

async function handleJsonUpload(request: NextRequest): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>;
  const action = String(body.action ?? "");

  if (action === "prepare") {
    const id = String(body.id ?? "");
    const fileName = String(body.fileName ?? "");
    const uploadedAt = String(body.uploadedAt ?? new Date().toISOString());
    const sheets = body.sheets as Array<{ name: string; headers: string[]; rowCount: number }>;

    if (!id || !fileName || !Array.isArray(sheets) || sheets.length === 0) {
      return Response.json({ error: "업로드 준비 정보가 올바르지 않습니다." }, { status: 400 });
    }

    createUploadSession(id, fileName, uploadedAt, sheets);
    return Response.json({ ok: true });
  }

  if (action === "chunk") {
    const uploadId = String(body.uploadId ?? "");
    const sheetName = String(body.sheetName ?? "");
    const rows = body.rows as Record<string, unknown>[];

    if (!uploadId || !sheetName || !Array.isArray(rows)) {
      return Response.json({ error: "청크 데이터가 올바르지 않습니다." }, { status: 400 });
    }

    const error = appendUploadChunk(uploadId, sheetName, rows);
    if (error) {
      discardUploadSession(uploadId);
      return Response.json({ error }, { status: 400 });
    }
    return Response.json({ ok: true });
  }

  if (action === "complete") {
    const uploadId = String(body.uploadId ?? "");
    if (!uploadId) {
      return Response.json({ error: "업로드 ID가 없습니다." }, { status: 400 });
    }

    const data = finalizeUploadSession(uploadId);
    if (!data) {
      return Response.json(
        { error: "업로드 세션이 만료되었거나 행 데이터가 불완전합니다. 파일을 다시 올려 주세요." },
        { status: 400 }
      );
    }

    return streamProcessedData(data);
  }

  return Response.json({ error: "지원하지 않는 업로드 요청입니다." }, { status: 400 });
}

async function handleFormUpload(request: NextRequest): Promise<Response> {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return Response.json({ error: "파일이 없습니다." }, { status: 400 });
  }

  const validExtensions = [".xlsx", ".xls", ".csv"];
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!validExtensions.includes(ext)) {
    return Response.json({ error: "지원 형식: .xlsx, .xls, .csv" }, { status: 400 });
  }

  const maxBytes = getPositiveEnvInt("UPLOAD_MAX_BYTES", DEFAULT_MAX_BYTES);
  if (file.size > maxBytes) {
    const maxMb = Math.floor(maxBytes / (1024 * 1024));
    return Response.json({ error: `파일이 너무 큽니다. (최대 ${maxMb}MB)` }, { status: 413 });
  }

  const buffer = await file.arrayBuffer();

  return createNdjsonStream(async (send) => {
    let data: ExcelData;
    try {
      data = parseExcelBuffer(buffer, file.name);
    } catch {
      send({
        type: "error",
        message: "파일을 읽을 수 없습니다. 손상되었거나 지원하지 않는 형식일 수 있습니다.",
      });
      return;
    }

    const validationError = validateParsedExcelData(data);
    if (validationError) {
      send({ type: "error", message: validationError });
      return;
    }

    await processUploadedExcelData(data, send);
  });
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    // Vercel 서버리스 요청 본문 한도(~4.5MB) 초과 파일은 브라우저에서 파싱 후 청크 JSON으로 전송
    if (contentType.includes("application/json")) {
      return handleJsonUpload(request);
    }

    return handleFormUpload(request);
  } catch (error) {
    console.error("Upload error:", error);
    return Response.json({ error: "파일을 읽는 중 오류가 발생했습니다." }, { status: 500 });
  }
}
