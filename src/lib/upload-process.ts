import { indexExcelFile } from "@/lib/rag";
import { persistUploadData } from "@/lib/upload-persistence";
import type { ExcelData } from "@/lib/types";

export type UploadStreamSender = (payload: Record<string, unknown>) => void;

/** 파싱 완료된 데이터를 저장·인덱싱하고 NDJSON 이벤트를 스트리밍합니다. */
export async function processUploadedExcelData(
  data: ExcelData,
  send: UploadStreamSender
): Promise<void> {
  await persistUploadData(data);
  send({ type: "uploaded", data });

  const result = await indexExcelFile(data, (progress) => {
    send({ type: "progress", ...progress });
  });
  send({ type: "done", ...result });
}
