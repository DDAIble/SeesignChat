import { NextRequest } from "next/server";
import { cleanupExpiredBlobs } from "@/lib/blob-cleanup";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * 만료된 업로드 객체(고아 파일) 청소.
 *
 * - Vercel Cron: CRON_SECRET이 설정돼 있으면 `Authorization: Bearer <CRON_SECRET>` 자동 첨부.
 * - GCP Cloud Scheduler: HTTP 타깃에 커스텀 헤더 `Authorization: Bearer <CRON_SECRET>` 를 넣어 호출.
 *   (Cloud Scheduler는 기본적으로 POST를 보냅니다. GET/POST 모두 지원합니다.)
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await cleanupExpiredBlobs();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("Upload cleanup cron error:", error);
    return Response.json({ ok: false, error: "cleanup failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
