// 一次性脚本：生成 PWA 图标（产物提交进仓库，Docker 构建自动带上）
// 运行：node scripts/generate-icons.mjs
//
// 不复用 src/app/icon.svg——它靠 <text>📚</text> emoji 渲染，
// sharp/librsvg 在无 emoji 字体的环境（Windows/容器）会画成豆腐块。
// 此处内嵌纯 path 图形：近黑圆角方底 + 白色开卷书线条 + 天蓝书签点缀。

import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// 开卷书图形（viewBox 0 0 100 100 居中构图）
const BOOK_PATHS = `
  <g fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M50 32 C 42 26, 30 25, 22 27 L 22 68 C 30 66, 42 67, 50 73 C 58 67, 70 66, 78 68 L 78 27 C 70 25, 58 26, 50 32 Z" />
    <path d="M50 32 L 50 73" />
  </g>
  <circle cx="67" cy="36" r="4.5" fill="#2997ff" />
`;

// 常规版：圆角方底，图形占比约 78%
function regularSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#1c1c1e" />
  <g transform="translate(50 50) scale(0.78) translate(-50 -50)">${BOOK_PATHS}</g>
</svg>`;
}

// maskable 版：底色满铺直角（裁形交给系统），图形缩至约 62% 居中留安全区
function maskableSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#1c1c1e" />
  <g transform="translate(50 50) scale(0.62) translate(-50 -50)">${BOOK_PATHS}</g>
</svg>`;
}

const ROOT = path.resolve(import.meta.dirname, "..");
const TASKS = [
  { svg: regularSvg(192), size: 192, out: "public/icons/icon-192.png" },
  { svg: regularSvg(512), size: 512, out: "public/icons/icon-512.png" },
  { svg: maskableSvg(512), size: 512, out: "public/icons/icon-maskable-512.png" },
  // apple-touch-icon：iOS 自行加圆角，给不透明满铺直角图
  { svg: maskableSvg(180), size: 180, out: "public/apple-touch-icon.png" },
];

await mkdir(path.join(ROOT, "public/icons"), { recursive: true });
for (const t of TASKS) {
  const file = path.join(ROOT, t.out);
  await sharp(Buffer.from(t.svg)).resize(t.size, t.size).png().toFile(file);
  console.log(`已生成 ${t.out}（${t.size}×${t.size}）`);
}
