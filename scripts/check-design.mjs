#!/usr/bin/env node
/* 设计系统门禁：把 docs/DESIGN.md 里的硬约束变成可执行检查。
 *
 * 存在的理由：本项目的前端没有任何自动化保护，vitest 只收 tests/ 下的后端
 * 纯逻辑，改 Tailwind 类、改布局、换组件结构 CI 一律绿灯。DESIGN.md 附录原本
 * 附了一条 grep 自查命令，但它有两处假阳性：一是 `bg-white(["\s/]|$)` 里的 `/`
 * 会误伤 chrome 面上完全合法的 `bg-white/10`；二是颜色字面量会命中平台元数据的
 * 必要输出。这份脚本是那条命令的可审计版本。
 *
 * 检查范围只含 src/ 下的 .ts / .tsx。globals.css 是所有 token 的唯一合法出处，
 * 按定义豁免。PWA manifest 与 theme-color 的精确例外在下方逐条列出，不能扩大成
 * 整个文件豁免。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

/* 平台元数据没有 CSS 变量可读，只能输出静态颜色值。这里按文件和整行精确豁免，
   避免有人在同一文件里新增内容区硬编码时绕过门禁。 */
const PLATFORM_COLOR_EXCEPTIONS = [
  {
    file: "src/app/manifest.ts",
    line: /^(background_color|theme_color): "#f5f5f7",$/,
  },
  {
    file: "src/components/theme-provider.tsx",
    line: /^const color = resolvedTheme === "dark" \? "#000000" : "#f5f5f7";$/,
  },
];

/* PR2 会把全部 arbitrary 圆角迁移到 rounded-card / rounded-utility /
   rounded-chip。PR1 先禁止新增，保留当前代码的精确数量作为迁移基线，避免
   在 token 地基批次混入视觉改动。每个文件和每种半径分别计数，新增一处即失败。 */
const LEGACY_RADIUS_BASELINE = {
  "src/app/(app)/inbox/inbox-client.tsx": { "rounded-[18px]": 2 },
  "src/app/(app)/inbox/loading.tsx": { "rounded-[8px]": 1, "rounded-[18px]": 1 },
  "src/app/(app)/loading.tsx": { "rounded-[8px]": 1, "rounded-[18px]": 1 },
  "src/app/(app)/notes/new/new-note-form.tsx": { "rounded-[18px]": 1 },
  "src/app/(app)/notes/[id]/loading.tsx": { "rounded-[18px]": 1, "rounded-[8px]": 1 },
  "src/app/(app)/notes/[id]/note-editor.tsx": {
    "rounded-[18px]": 1,
    "rounded-[6px]": 4,
  },
  "src/app/(app)/search/search-client.tsx": { "rounded-[18px]": 2 },
  "src/app/(app)/settings/settings-panel.tsx": { "rounded-[18px]": 9 },
  "src/app/(app)/page.tsx": { "rounded-[14px]": 3 },
  "src/app/(app)/topics/[id]/loading.tsx": { "rounded-[8px]": 1, "rounded-[18px]": 1 },
  "src/app/(app)/trash/trash-client.tsx": { "rounded-[18px]": 1 },
  "src/components/chat/chat-panel.tsx": {
    "rounded-[8px]": 1,
    "rounded-[12px]": 1,
    "rounded-[18px]": 5,
  },
  "src/components/chat/source-picker.tsx": { "rounded-[10px]": 1, "rounded-[12px]": 1 },
  "src/components/confirm-dialog.tsx": { "rounded-[18px]": 1 },
  "src/components/markdown-editor.tsx": { "rounded-[6px]": 3, "rounded-[10px]": 1 },
  "src/components/mermaid-code-block.tsx": { "rounded-[8px]": 1 },
  "src/components/nav.tsx": { "rounded-[8px]": 2 },
  "src/components/note-card.tsx": { "rounded-[12px]": 1, "rounded-[18px]": 1 },
  "src/components/slash-menu.tsx": { "rounded-[12px]": 1 },
};

/* 每条规则对应 DESIGN.md 的一条硬约束。新增规则请同步更新文档，
   否则门禁和文档会各说各话。 */
const RULES = [
  {
    name: "裸色类只允许出现在主题不变面",
    // bg-white 不带透明度即违规。带透明度的 bg-white/N 是 chrome、tile、
    // scrim 上的合法写法，故 `/` 不进字符类——这正是原 grep 的假阳性来源。
    pattern: /bg-white(["'\s]|$)/,
    hint: "内容区请用 bg-surface / bg-canvas 等语义 token",
  },
  {
    name: "低透明度黑不得用作内容区填充",
    // bg-black/40、bg-black/85 是遮罩与底部 Tab 的合法用法，不在此列
    pattern: /bg-black\/(5|10)\b/,
    hint: "面上填充请用 bg-fill，骨架薄纱请用 bg-veil/5",
  },
  {
    name: "语义色不得硬编码",
    pattern: /#ff3b30|#0066cc|#1d1d1f|#f5f5f7/i,
    hint: "请改用 text-danger / bg-action / bg-cta 等 token 类",
  },
  {
    name: "ink 是文字色，不得用作背景",
    pattern: /bg-ink(["'\s]|$)/,
    hint: "暗色面请用 bg-chrome / bg-tile",
  },
];

function isPlatformColorException(file, line) {
  return PLATFORM_COLOR_EXCEPTIONS.some(
    (exception) => exception.file === file && exception.line.test(line.trim()),
  );
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(SRC);
let failed = 0;

for (const rule of RULES) {
  const hits = [];
  for (const file of files) {
    const relativeFile = relative(ROOT, file).replace(/\\/g, "/");
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (rule.pattern.test(line) && !isPlatformColorException(relativeFile, line)) {
        hits.push(`${relativeFile}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  if (hits.length > 0) {
    failed += hits.length;
    console.error(`✗ ${rule.name}（${hits.length} 处）`);
    console.error(`  ${rule.hint}`);
    for (const hit of hits) console.error(`    ${hit}`);
    console.error("");
  } else {
    console.log(`✓ ${rule.name}`);
  }
}

/* 任意圆角采用“禁止新增”的迁移门禁。当前基线会在 PR2 清零；这里不做整文件
   豁免，所以换文件、换半径或增加同类用法都会立即暴露。 */
const radiusHits = [];
let legacyRadiusCount = 0;
for (const file of files) {
  const relativeFile = relative(ROOT, file).replace(/\\/g, "/");
  const baseline = LEGACY_RADIUS_BASELINE[relativeFile] ?? {};
  const seen = {};
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const matches = line.match(/rounded-\[\d+px\]/g) ?? [];
    for (const token of matches) {
      legacyRadiusCount += 1;
      seen[token] = (seen[token] ?? 0) + 1;
      if (seen[token] > (baseline[token] ?? 0)) {
        radiusHits.push(`${relativeFile}:${i + 1}  ${token}`);
      }
    }
  });
}

if (radiusHits.length > 0) {
  failed += radiusHits.length;
  console.error(`✗ 任意圆角类不得新增（${radiusHits.length} 处）`);
  console.error("  请改用 rounded-card / rounded-utility / rounded-chip；PR2 将清零现有迁移基线。");
  for (const hit of radiusHits) console.error(`    ${hit}`);
  console.error("");
} else {
  console.log(`✓ 任意圆角类不得新增（现存迁移项 ${legacyRadiusCount} 处）`);
}

if (failed > 0) {
  console.error(`设计系统门禁未通过：共 ${failed} 处违规。规则见 docs/DESIGN.md。`);
  process.exit(1);
}
console.log(`设计系统门禁通过（检查了 ${files.length} 个文件）。`);
