import { NextRequest } from "next/server";
import { parseExcelBuffer } from "@/lib/excel";
import { indexExcelFile } from "@/lib/rag";
import { persistUploadData } from "@/lib/upload-persistence";

export const maxDuration = 300;

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

    const buffer = await file.arrayBuffer();
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        };

        try {
          const data = parseExcelBuffer(buffer, file.name);
          await persistUploadData(data);
          send({ type: "uploaded", data });

          const result = await indexExcelFile(data, (progress) => {
            send({ type: "progress", ...progress });
          });
          send({ type: "done", ...result });
        } catch (error) {
          send({
            type: "error",
            message:
              error instanceof Error ? error.message : "파일을 처리하는 중 오류가 발생했습니다.",
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
