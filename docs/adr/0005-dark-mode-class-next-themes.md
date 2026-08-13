# 0005. 暗色模式：next-themes class 策略 + `.dark {}` 直接覆盖 token

日期：2026-08-12

状态：已采纳

## 背景

应用要支持三态外观（浅色 / 深色 / 跟随系统，默认跟随系统），偏好各设备独立记忆、不做服务端同步。样式体系是 Tailwind CSS v4（CSS-first），全部颜色以语义 token 形式定义在 `globals.css` 的 `@theme` 块中（`--color-parchment`、`--color-ink` 等），此前仅有亮色一套值。SSR 首屏必须无闪烁（FOUC）。

## 决策

1. **class 策略**：`@custom-variant dark (&:where(.dark, .dark *));`，由 next-themes 把 `.dark` 挂在 `<html>` 上。
2. **token 双套值**：`@theme` 保存亮色默认值；`globals.css` 中新增一个**未分层**的 `.dark {}` 块直接覆盖 `--color-*` 变量。Tailwind v4 工具类编译产物本就引用 `var(--color-x)`，因此工具类与手写 CSS（如 `body { background: var(--color-parchment) }`）全部自动翻转。
3. **偏好存储与防闪烁**：next-themes 存 `localStorage("theme")`，并在 `<head>` 注入阻塞内联脚本，水合前就把 class 写上 `<html>`（根布局需 `suppressHydrationWarning`）。
4. **主题不变面**：`chrome`（侧栏/FAB 背景）、`tile`/`tile-2`（暗面瓷砖）、`sky`、`dark-muted` 在 `.dark {}` 中不覆盖，两种模式同值；暗色下它们比 `#000` 页底亮一档，elevation 分层自然成立。
5. **PWA 状态栏联动**：SSR 输出媒体查询双值 `theme-color` meta（跟随系统）；客户端 `ThemeColorSync` 在用户手动锁定主题后重建为单一颜色值。

## 前提约束（破坏即静默失效）

- `.dark` 类必须挂在 `<html>`（`:root` 元素）上——`@theme` 变量由 Tailwind 输出在 `@layer theme` 的 `:root` 规则里，我们的覆盖块靠"未分层 CSS 胜过任何 @layer"+"同元素后来居上"两条保险生效。若未来把 `.dark` 挂到 `body`，或把覆盖块搬进某个 `@layer`，覆盖会静默失效。
- 裸色类（`text-white`、`bg-white/10`、`bg-black/40` 等）仅允许出现在主题不变面（chrome、tile、accent 按钮、scrim 遮罩）上，其余一律使用语义 token——完整对照表见 docs/DESIGN.md 附录。

## 备选方案与否决理由

1. **纯 `prefers-color-scheme` 媒体查询**：零 JS、零存储，但无法提供"手动锁定浅色/深色"的三态控制。否决。
2. **偏好存 cookie 由 SSR 输出 class**：无需内联脚本也无闪烁，但引入服务端状态且"跟随系统"仍需客户端判断，复杂度反而更高；且与"不做服务端同步"的决策冲突。否决。
3. **shadcn 式 `:root/.dark` 原始变量 + `@theme inline` 间接层**：适合 token 引用其他变量的场景；本项目 token 全部是字面色值，用不上间接层，直接覆盖 diff 最小。否决。
4. **手写主题切换（不引 next-themes）**：可行（约 50 行），但三态 + 系统偏好监听 + 防闪烁脚本 + 跨标签同步都是踩坑点，next-themes（约 2KB、React 19 兼容）已是社区标准答案。否决。

## 后果

- 新增依赖 `next-themes`；新增 `src/components/theme-provider.tsx`；设置页新增「外观」分段控件（带 mounted 守卫防 hydration mismatch）。
- 全站 17 个文件约 86 处硬编码颜色类清理为语义 token（`bg-white`→`bg-surface` 等），并新增 `surface/canvas/fill/chrome/danger/danger-tint/veil` 七个 token。
- 验收项：设置页切换三态即时生效；刷新任意页面首帧即为目标主题（无闪烁）；`html` 的 `color-scheme` 随主题切换（原生控件配色跟随）。
