import { getUploadLimits } from "@/lib/upload-limits";

export const dynamic = "force-dynamic";

/** 업로드 UI 안내용 — 서버 환경변수 기준 한도 반환 */
export async function GET() {
  return Response.json(getUploadLimits());
}
