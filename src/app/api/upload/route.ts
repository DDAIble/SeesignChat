import { NextRequest } from "next/server";
import { parseExcelBuffer } from "@/lib/parse-excel";
import { processUploadedExcelData } from "@/lib/upload-process";
import { validateParsedExcelData } from "@/lib/upload-validate";
import { getUploadMaxFileBytes } from "@/lib/upload-limits";
import { formatMaxMb } from "@/lib/upload-errors";
import type { ExcelData } from "@/lib/types";

export const maxDuration = 300;

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

export async function POST(request: NextRequest) {
  try {
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

    const maxBytes = getUploadMaxFileBytes();
    if (file.size > maxBytes) {
      return Response.json(
        { error: `파일이 너무 큽니다. 파일당 최대 ${formatMaxMb(maxBytes)}까지 업로드할 수 있습니다.` },
        { status: 413 }
      );
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
  } catch (error) {
    console.error("Upload error:", error);
    return Response.json({ error: "파일을 읽는 중 오류가 발생했습니다." }, { status: 500 });
  }
}
