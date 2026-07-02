/** 프로덕션: `/chat` — aible-box 게이트웨이 하위 경로 */
export const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

export function withBasePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${basePath}${normalized}`;
}

/** public/ 정적 파일 URL (basePath 포함) */
export function publicAsset(path: string): string {
  return withBasePath(path);
}
