# ---- 构建阶段 ----
# 使用 bookworm-slim（glibc）：better-sqlite3 / @node-rs/jieba 均有预编译产物，免现场编译
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- 运行阶段 ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# standalone 输出已包含裁剪后的 node_modules（含原生模块）
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 数据目录（挂卷）：数据库 /data/db，图片 /data/uploads
RUN mkdir -p /data/db /data/uploads && chown -R node:node /data /app
USER node

ENV DATABASE_PATH=/data/db/app.db
ENV UPLOAD_DIR=/data/uploads
ENV PORT=3000
EXPOSE 3000

# 容器健康检查：slim 镜像无 curl/wget，用 Node 22 自带 fetch 探测；compose 未显式定义时自动继承
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 迁移在应用启动时自动执行（src/db/index.ts），无需单独迁移步骤
CMD ["node", "server.js"]
