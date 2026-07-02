# syntax=docker/dockerfile:1

# ---- 의존성 설치 ----
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 빌드 ----
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* 는 빌드 시점에 브라우저 번들에 박힙니다.
# Cloud Build / docker build 시 --build-arg 로 주입하세요.
ARG NEXT_PUBLIC_BASE_PATH=""
ARG NEXT_PUBLIC_AIBLE_BOX_URL=""
ARG NEXT_PUBLIC_SEESIGN_ADMIN_URL=""
ARG NEXT_PUBLIC_CHAT_GUIDE_URL=""
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
ENV NEXT_PUBLIC_AIBLE_BOX_URL=$NEXT_PUBLIC_AIBLE_BOX_URL
ENV NEXT_PUBLIC_SEESIGN_ADMIN_URL=$NEXT_PUBLIC_SEESIGN_ADMIN_URL
ENV NEXT_PUBLIC_CHAT_GUIDE_URL=$NEXT_PUBLIC_CHAT_GUIDE_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---- 실행 ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Cloud Run은 PORT 환경변수를 주입합니다. Next standalone 서버가 이를 사용합니다.
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 8080

CMD ["node", "server.js"]
