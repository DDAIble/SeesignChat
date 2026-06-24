import { NextRequest } from "next/server";
import { indexExcelFile } from "@/lib/rag";
import { getUploadData, removeUploadData } from "@/lib/upload-data-store";
import type { ExcelData } from "@/lib/types";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { data?: ExcelData; fileId?: string };
    const data = body.fileId ? getUploadData(body.fileId) : body.data;

    if (!data?.id) {
      const message = body.fileId
        ? "서버에서 파일 데이터를 찾을 수 없습니다. 파일을 다시 업로드해 주세요."
        : "유효한 파일 데이터가 없습니다.";
      return Response.json({ error: message }, { status: body.fileId ? 404 : 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        };

        try {
          const result = await indexExcelFile(data, (progress) => {
            send({ type: "progress", ...progress });
          });
          send({ type: "done", ...result });
        } catch (error) {
          send({
            type: "error",
            message: error instanceof Error ? error.message : "임베딩 인덱싱 중 오류가 발생했습니다.",
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
    console.error("Embed error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "임베딩 인덱싱 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const fileId = request.nextUrl.searchParams.get("fileId");
    if (!fileId) {
      return Response.json({ error: "fileId가 필요합니다." }, { status: 400 });
    }

    const { removeFileIndex } = await import("@/lib/rag");
    const removed = removeFileIndex(fileId);
    removeUploadData(fileId);
    return Response.json({ fileId, removed });
  } catch (error) {
    console.error("Embed delete error:", error);
    return Response.json({ error: "인덱스 삭제 중 오류가 발생했습니다." }, { status: 500 });
  }
}
