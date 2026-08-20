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

/* Mermaid NodeView 是本轮明令冻结的高风险文件。它内部这一个旧类按文件和整行
   精确豁免；除该行外，任意圆角必须在全仓零命中。 */
const FROZEN_RADIUS_EXCEPTION = {
  file: "src/components/mermaid-code-block.tsx",
  line: '"cursor-pointer overflow-x-auto rounded-[8px] bg-fill p-3 " +',
};

/* rounded-full 只允许真实圆形控件与计数角标。普通按钮、输入框和 chip 必须分别
   使用 rounded-utility / rounded-chip，避免胶囊语法重新蔓延。 */
const ROUNDED_FULL_EXCEPTIONS = [
  {
    file: "src/app/(app)/layout.tsx",
    line: 'className="fixed bottom-20 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-cta text-cta-ink transition-transform active:scale-95 md:bottom-10 md:right-10"',
  },
  {
    file: "src/app/(app)/page.tsx",
    line: "className={`rounded-full px-2.5 py-0.5 font-mono text-meta font-semibold ${",
  },
  {
    file: "src/app/(app)/topics/[id]/topic-notes.tsx",
    line: 'className="-m-2 shrink-0 rounded-full p-2 text-ink-48 transition-colors hover:text-danger active:scale-95"',
  },
  {
    file: "src/components/chat/chat-panel.tsx",
    line: 'className="fixed bottom-20 right-[5.5rem] z-20 flex h-12 w-12 items-center justify-center rounded-full bg-chrome text-white shadow-lg transition-transform active:scale-95 dark:ring-1 dark:ring-white/15 md:bottom-10 md:right-[6.75rem]"',
  },
  {
    file: "src/components/nav.tsx",
    line: '<span className="rounded-full bg-danger px-1.5 font-mono text-micro font-semibold leading-4 text-white">',
  },
];

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

/* 任意圆角全量零命中；唯一例外是冻结的 Mermaid NodeView 精确行。 */
const radiusHits = [];
for (const file of files) {
  const relativeFile = relative(ROOT, file).replace(/\\/g, "/");
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const matches = line.match(/rounded-\[\d+px\]/g) ?? [];
    for (const token of matches) {
      const frozen =
        relativeFile === FROZEN_RADIUS_EXCEPTION.file &&
        FROZEN_RADIUS_EXCEPTION.line === line.trim();
      if (!frozen) {
        radiusHits.push(`${relativeFile}:${i + 1}  ${token}`);
      }
    }
  });
}

if (radiusHits.length > 0) {
  failed += radiusHits.length;
  console.error(`✗ 任意圆角类必须清零（${radiusHits.length} 处）`);
  console.error("  请改用 rounded-card / rounded-utility / rounded-chip。");
  for (const hit of radiusHits) console.error(`    ${hit}`);
  console.error("");
} else {
  console.log("✓ 任意圆角类已清零（冻结的 Mermaid 精确行除外）");
}

const roundedFullHits = [];
for (const file of files) {
  const relativeFile = relative(ROOT, file).replace(/\\/g, "/");
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!line.includes("rounded-full")) return;
    const allowed = ROUNDED_FULL_EXCEPTIONS.some(
      (exception) => exception.file === relativeFile && exception.line === line.trim(),
    );
    if (!allowed) roundedFullHits.push(`${relativeFile}:${i + 1}  ${line.trim()}`);
  });
}

if (roundedFullHits.length > 0) {
  failed += roundedFullHits.length;
  console.error(`✗ rounded-full 只允许圆形控件与计数角标（${roundedFullHits.length} 处）`);
  console.error("  普通控件请改用 rounded-utility，标签请用 rounded-chip。");
  for (const hit of roundedFullHits) console.error(`    ${hit}`);
  console.error("");
} else {
  console.log("✓ rounded-full 只用于圆形控件与计数角标");
}

if (failed > 0) {
  console.error(`设计系统门禁未通过：共 ${failed} 处违规。规则见 docs/DESIGN.md。`);
  process.exit(1);
}
console.log(`设计系统门禁通过（检查了 ${files.length} 个文件）。`);
