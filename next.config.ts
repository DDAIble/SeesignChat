import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  // Cloud Run(Docker) 배포용 — 최소 실행 번들 생성
  output: "standalone",
};

export default nextConfig;
