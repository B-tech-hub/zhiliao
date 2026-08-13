import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // 构建目录可用环境变量覆盖（默认 .next）：规避 Windows 下残留句柄锁死目录导致 build 卡住
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // 关闭 Next.js 开发模式左下角的英文调试按钮（生产环境本就没有）
  devIndicators: false,
  // 原生模块不能被打包器处理，保持外部依赖
  serverExternalPackages: ["better-sqlite3", "@node-rs/jieba"],
  experimental: {
    // 客户端 Router Cache 保鲜期：30s 内重复导航零请求瞬时切换；
    // prefetch 缓存收窄到 3 分钟，控制后台 AI worker 分类造成的计数滞后上限
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
