import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 커스텀 도메인(게이트웨이) 경유만 허용할 때 Vercel env에 설정:
 * ALLOWED_HOSTS=tools.company.com
 * 미설정 시 검증 생략 — 로컬 개발 및 초기 배포용
 */
function getAllowedHosts(): string[] {
  return (process.env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function middleware(request: NextRequest) {
  const allowedHosts = getAllowedHosts();
  if (allowedHosts.length === 0) {
    return NextResponse.next();
  }

  const rawHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const host = rawHost.split(":")[0]?.toLowerCase() ?? "";

  if (!allowedHosts.includes(host)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/chat",
    "/chat/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
