# syntax=docker/dockerfile:1.7
#
# Aivora · 中国大陆部署 Docker 镜像
#
# 设计要点：
# - 多 stage：deps → builder → runner，最终镜像约 350MB（含 ffmpeg）
# - 基础镜像：node:20-bookworm-slim（apt 装 ffmpeg；alpine 装 ffmpeg 路径较曲折）
# - 不依赖 Vercel runtime；标准 `next build` + `next start`，运行在普通 Node 服务器
# - 同一镜像可同时跑 web 与 worker（docker compose 用不同 command 启动）
#
# 构建：
#   docker build -t aivora-cn:latest .
# 推到火山 ACR：
#   docker tag aivora-cn:latest cr.cn-beijing.volces.com/<ns>/aivora-cn:latest
#   docker push cr.cn-beijing.volces.com/<ns>/aivora-cn:latest

# -------------------------------------------------------------
# Stage 1: 依赖安装（lockfile aware）
# -------------------------------------------------------------
FROM node:20-bookworm-slim AS deps

WORKDIR /app

# 中国大陆下载加速；CI 或海外构建时移除即可
RUN npm config set registry https://registry.npmmirror.com

COPY package.json package-lock.json* ./
COPY prisma ./prisma

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=optional && \
    npx prisma generate

# -------------------------------------------------------------
# Stage 2: 构建 Next.js
# -------------------------------------------------------------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .

# 构建时不需要真实业务 env；用占位通过 build
# 真正的 env 在 docker run 时通过 --env-file 注入
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    AUTH_SECRET=build-only-secret \
    NEXT_PUBLIC_APP_URL=http://localhost \
    npm run build

# -------------------------------------------------------------
# Stage 3: 运行时（ffmpeg + curl + healthcheck）
# -------------------------------------------------------------
FROM node:20-bookworm-slim AS runner

LABEL org.opencontainers.image.title="Aivora · China deployment"
LABEL org.opencontainers.image.source="https://github.com/your-org/aivora"

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        ca-certificates \
        curl \
        tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js 默认监听 0.0.0.0:3000
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# 复制构建产物 + node_modules + prisma + scripts（worker 用）
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/next.config.ts ./next.config.ts

# 非 root 用户（安全 + 与 Linux 服务器最佳实践一致）
RUN groupadd -g 1001 nodejs && \
    useradd -m -u 1001 -g 1001 -s /bin/bash nextjs && \
    mkdir -p /app/tmp && chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

# tini 防止 PID 1 信号问题（Next.js + child ffmpeg）
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "start"]

# 健康检查（compose 也单独配了一份）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1
