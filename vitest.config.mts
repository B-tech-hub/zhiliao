import path from "node:path";
import { defineConfig } from "vitest/config";

// pool: "forks"：better-sqlite3 / @node-rs/jieba 为原生模块，子进程池比线程池稳；
// 且每个测试文件独占进程 → 独享 globalThis 单例与 :memory: 数据库，天然隔离
export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
  },
  // tsconfig 是 Next 的 jsx: "preserve"，vite 照搬会解析不了 .tsx；
  // 这里让 esbuild 自己转换（编辑器扩展定义在 .tsx 里，测试要 import 它）
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
