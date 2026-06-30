import { NextRequest } from "next/server";
import { cleanupExpiredBlobs } from "@/lib/blob-cleanup";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Vercel Cron 전용 — 만료된 Blob(고아 파일) 청소.
 * Vercel은 CRON_SECRET이 설정돼 있으면 `Authorization: Bearer <CRON_SECRET>` 헤더를 자동으로 붙여 호출합니다.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await cleanupExpiredBlobs();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("Blob cleanup cron error:", error);
    return Response.json({ ok: false, error: "cleanup failed" }, { status: 500 });
  }
}
