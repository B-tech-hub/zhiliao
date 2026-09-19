---
title: 'R1 设置页刷新 React #418'
type: 'bugfix'
created: '2026-09-16'
status: 'done'
baseline_commit: 'f213761b795cc020be2122e27301fe4a7c5cf7a0'
approval_scope: '2026-09-16 用户先确认实施修复、局部测试与文档同步，随后确认一次含补丁的候选构建和隔离浏览器复验；全量测试及发布不在本次授权内'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/R1设置页刷新React418调查-2026-09-16.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 设置页已有备份时，时间文案依赖两端时区和当前日期，已在原组件复现水合错误；原 R1 事件高度吻合，完整页面归因待验。

**Approach:** 仅稳定备份时间首帧，挂载后沿用浏览器本地时间。

## Boundaries & Constraints

**Always:** 单 Agent；保留既有差异和旧证据；使用隔离数据。

**Ask First:** 实现须确认；构建、浏览器及全量验证须明确授权，已授权范围不重复询问。

**Never:** 修改全局时区或共享时间口径、扩散 suppressHydrationWarning、关闭整页 SSR；更改数据/API、版本、Story/Sprint 或发布。

## I/O & Edge-Case Matrix

| 状态 | 首帧 | 挂载后 |
|---|---|---|
| 无备份 | 从未备份 | 从未备份 |
| 有备份，包括时间戳 0 | — | 本地时间 |
| 时区不同、跨日或跨年 | 两端一致 | 本地时间 |
| 手动备份成功/失败 | 保持当前显示 | 成功更新时间；失败保留旧值与错误提示 |

</frozen-after-approval>

## Code Map

- `src/app/(app)/settings/page.tsx:72`：服务端传入 lastBackupAt；只读，含既有 Demo 修复。
- `src/app/(app)/settings/settings-panel.tsx:290,366`：修复前 DataSection 初始化并直接格式化时间；现在复用 AppearanceSection 的挂载守卫。
- `src/components/note-card.tsx:12`：formatTime 依赖本地时区和当前日期；其他调用点保持。
- `src/lib/backup.ts:34,40`：启动五分钟后备份，读取 mtime；只读。
- [调查报告](../../docs/R1设置页刷新React418调查-2026-09-16.md)：九项源码/锁文件与原快照一致；原备份先于刷新，后续复验 DOM 为“从未备份”；含原日志、内存复现及文档矩阵。
- `tests/components/api-token-section.test.tsx`：复用组件隔离约定；测试恢复时区、时钟与 DOM。

## Tasks & Acceptance

**Execution:**

- [x] `tests/components/settings-panel-hydration.test.tsx`：真实组件 SSR→hydrateRoot，模拟外部边界；旧代码复现后覆盖上表。
- [x] `src/app/(app)/settings/settings-panel.tsx`：仅备份时间首帧使用中性占位，挂载后格式化。
- [x] `docs/R1安装验收-2026-09-15.md`：追加分层结果；按调查报告文档矩阵同步 UI、PRD、索引、执行清单、CHANGELOG、Release Notes 和 deferred-work。
- [x] `docs/验收证据/r1-settings-hydration-browser-20260916T041726Z-9b7d27a9/`：按追加授权构建一次新候选，完成真实备份、时区、设置刷新与截图矩阵，并清理隔离资源。

**Acceptance Criteria:**

- Given 跨时区或跨日/年，when 水合，then 无可恢复错误或水合警告。
- Given 隔离普通模式，when 备份、保存设置后刷新，then 时间及配置正确、密钥脱敏、其他操作可用。
- Given 局部验证完成，when 记录结论，then 区分代码与生产页面证据，不关闭完整 R1。

## Spec Change Log

## Design Notes

已复现 UTC 02:22 / 上海 10:22 的 span 差异；原浏览器时区、首帧 HTML 与精确 mtime 未留存。只延后时间文字一帧，风险是占位语义和窄屏排版。多 Agent 指引按用户要求覆盖；现有工作区保留。2026-09-16 用户先确认实施修复、局部测试和文档同步，随后确认一次包含补丁的候选构建与隔离浏览器复验，继续保持单 Agent。

## Verification

已获准并执行（另保存 JSON 结果）：

- `npx --no-install vitest run tests/components/settings-panel-hydration.test.tsx --maxWorkers=1 --no-file-parallelism`
- `npx --no-install eslint 'src/app/(app)/settings/settings-panel.tsx' tests/components/settings-panel-hydration.test.tsx`

生产复验见调查报告第 6 节，现已获准；使用包含补丁的新候选，旧镜像仅作对照。运行标识为 `20260916T041726Z-9b7d27a9`，源码清单 SHA-256 为 `8474075a8140692fd38dc7369534d466f8422607710f31589fb938f3de9c0350`。

结果：旧代码 6 失败、7 通过；修复后 13 项全部通过，无跳过，目标文件 ESLint 为 0 错误/0 警告。[局部矩阵证据](../../docs/R1安装验收-2026-09-15.md#settings-hydration-repair)覆盖 I/O 表每一行。

追加授权后，一次候选构建成功；[14 个生产页面场景及 10 张截图](../../docs/R1安装验收-2026-09-15.md#settings-hydration-browser)通过。AC 1 有局部跨日/年与浏览器跨时区/受控跨年的证据；AC 2 已用普通模式、真实登录、真实备份、配置持久化、刷新和导航验收，密钥保持脱敏；AC 3 的分层结论与文档已同步。原现场时区/首帧缺证保持，不推进完整 R1、Story/Sprint 或发布。


单 Agent 复核未发现待修补项或验证缺口，见[复核记录](../../docs/验收证据/r1-settings-hydration-browser-20260916T041726Z-9b7d27a9/review.md)。用户的单 Agent 与保留既有工作区约定覆盖技能默认的并行评审和自动提交；未设置 story_key，跳过 Sprint 同步。
## Suggested Review Order

**首帧与本地时间**

- 已有备份先占位，挂载后本地化。
  [settings-panel.tsx:303](<../../src/app/(app)/settings/settings-panel.tsx#L303>)

**生产页面与证据边界**

- 核对候选身份、真实备份及专项结论。
  [R1安装验收-2026-09-15.md:225](<../../docs/R1安装验收-2026-09-15.md#L225>)

**回归与边界用例**

- 检查跨时区、日期边界及备份失败。
  [settings-panel-hydration.test.tsx:106](<../../tests/components/settings-panel-hydration.test.tsx#L106>)
