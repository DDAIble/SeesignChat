import { NextRequest } from "next/server";
import { parseExcelBuffer } from "@/lib/excel";
import { indexExcelFile } from "@/lib/rag";
import { persistUploadData } from "@/lib/upload-persistence";
import type { ExcelData } from "@/lib/types";

export const maxDuration = 300;

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_SHEETS = 30;
const DEFAULT_MAX_TOTAL_ROWS = 200_000;

function getPositiveEnvInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function validateParsedData(data: ExcelData): string | null {
  const maxSheets = getPositiveEnvInt("UPLOAD_MAX_SHEETS", DEFAULT_MAX_SHEETS);
  const maxTotalRows = getPositiveEnvInt("UPLOAD_MAX_TOTAL_ROWS", DEFAULT_MAX_TOTAL_ROWS);

  if (data.sheets.length > maxSheets) {
    return `시트가 너무 많습니다. (최대 ${maxSheets.toLocaleString()}개)`;
  }

  const totalRows = data.sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0);
  if (totalRows > maxTotalRows) {
    return `데이터 행이 너무 많습니다. (최대 ${maxTotalRows.toLocaleString()}행)`;
  }

  if (totalRows === 0) {
    return "데이터 행이 없습니다. 파일 내용을 확인해 주세요.";
  }

  return null;
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

    const maxBytes = getPositiveEnvInt("UPLOAD_MAX_BYTES", DEFAULT_MAX_BYTES);
    if (file.size > maxBytes) {
      const maxMb = Math.floor(maxBytes / (1024 * 1024));
      return Response.json(
        { error: `파일이 너무 큽니다. (최대 ${maxMb}MB)` },
        { status: 413 }
      );
    }

    const buffer = await file.arrayBuffer();
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        };

        try {
          let data: ExcelData;
          try {
            data = parseExcelBuffer(buffer, file.name);
          } catch {
            throw new Error("파일을 읽을 수 없습니다. 손상되었거나 지원하지 않는 형식일 수 있습니다.");
          }

          const validationError = validateParsedData(data);
          if (validationError) {
            send({ type: "error", message: validationError });
            return;
          }

          await persistUploadData(data);
          send({ type: "uploaded", data });

          const result = await indexExcelFile(data, (progress) => {
            send({ type: "progress", ...progress });
          });
          send({ type: "done", ...result });
        } catch (error) {
          console.error("Upload processing error:", error);
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
  } catch (error) {
    console.error("Upload error:", error);
    return Response.json(
      { error: "파일을 읽는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
