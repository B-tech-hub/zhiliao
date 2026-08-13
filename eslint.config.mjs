import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// eslint-config-next 仍以传统 shareable config 分发，用 FlatCompat 桥接到 ESLint 9 扁平配置
const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".next-verify/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Service Worker 运行在独立环境（self/caches 全局），不按应用代码规则检查
      "public/sw.js",
    ],
  },
];

export default eslintConfig;
