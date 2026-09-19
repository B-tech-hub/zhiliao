---
title: 'R1 TipTap v2 安全回补'
type: 'bugfix'
created: '2026-09-19'
status: 'done'
baseline_commit: 'f213761b795cc020be2122e27301fe4a7c5cf7a0'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** core 2.27.2 存在属性原型缺陷；当前入口未发现完整利用通路，实际编辑器专项缺证。

**Approach:** 仅用官方 2.27.3 回补，补定向回归。公告仍覆盖该版本，保留扫描结果并关联行为证据。

**用户批准的范围补充（2026-09-19）：** 纳入已复现的图片往返缺陷；在 RichImage 中补最小序列化，保留宽度/对齐并修复图片与表格间的分隔，复用现有依赖并局部回归。

## Boundaries & Constraints

**Always:** 单 Agent；保留既有改动；应用版本 0.6.1；沿用 Markdown 出口与固定 schema。

**Ask First:** 实施需确认；额外依赖变更、build、全量测试、真实浏览器、新候选及发布另行确认。

**Never:** v3 迁移、关闭 HTML、自制补丁、风险静默豁免、改旧证据或 Sprint 状态。

## I/O & Edge-Case Matrix

| 场景 | 输入 | 期望 | 失败处理 |
|---|---|---|---|
| helper | JSON 自有 __proto__ | 原型正常，DOM 无继承属性；允许自有数据键 | 不放行 |
| 编辑器 | 加载、同步、粘贴、拖放 | 过滤危险属性，保留正常正文 | 留证分诊 |
| 往返 | 图片/公式/表格/链接/代码 | 语义与源码不丢失 | 不放行 |
| 审计 | 同一公告继续命中 | 保留结果并关联回补证据 | 新公告另查 |

</frozen-after-approval>

## Code Map

- `docs/TipTap残余风险调查-2026-09-19.md`：入口矩阵、官方包证据、兼容约束与验收细节，实施前必读。
- `src/components/markdown-editor.tsx:30/:70/:395`：真实扩展及入口，不复制成平行测试实现。
- `node_modules/@tiptap/core/src/utilities/mergeAttributes.ts`：缺陷位置，只读，不手工修改安装包。

## Tasks & Acceptance

**Execution:**
- [x] `package.json`、`package-lock.json`：新增 core 精确 override 2.27.3；临时副本解析、审核后应用，禁用安装脚本；仅 core 与根元数据变化。
- [x] `tests/lib/tiptap-security.test.ts`：ESM/CJS helper、DOMSerializer、正常 class/style 合并回归；旧版对照须能检出缺陷。
- [x] `tests/components/markdown-editor-security.test.tsx`：实际组件加载/setContent、文本/HTML 粘贴与拖放、data-pm-slice；覆盖表格、图片、公式、链接、Mermaid 两态和往返，使用隔离惰性样本。
- [x] `src/components/markdown-editor.tsx`、`docs/adr/0002-image-attrs-inline-html.md`：恢复既有图片属性 HTML 序列化约定，块级图片正确分隔；普通图片继续输出 Markdown，同步缺陷修复记录。
- [x] `docs/依赖告警分诊-2026-09-18.md`、`docs/README.md`、`docs/产品规划/开源发布范围与执行清单-2026-09-13.md`、`docs/releases/v0.6.1.md`、`CHANGELOG.md`：同步结果及待验收边界，证据追加到独立目录。

**Acceptance Criteria:**
- Given 修补依赖，When 核对安装树及双入口，Then 无旧 core、peer 冲突或范围外升级。
- Given 上表样本，When 定向回归，Then 安全与正文保真均通过，不以清空内容代替过滤。
- Given 修补审计，When 公告仍命中，Then 明示元数据差异，不宣称零告警或发布完成。

## Spec Change Log

- 2026-09-19：旧 core 下组件基线 16 项通过、4 项失败，确认图片属性和相邻表格往返缺陷。用户明确批准最小序列化修复与局部回归，因此在冻结块追加范围补充；原有条文保留，不增加依赖、不改变数据格式约定。

## Design Notes

工作区为既有发布收尾；本次调查只新增材料。用户明确单 Agent、确认前不实施，覆盖技能的子 Agent 建议；未进入实施步骤。

2026-09-19 用户确认按方案实施并做局部验证。规格已重读，冻结块无外部修改；继续单 Agent，未启用 Sprint 同步。构建、全量测试、真实浏览器与发布仍不在本次授权内。

## Verification

- 定向 Vitest：两个新增测试文件及 `tests/lib/math.test.ts`、`tests/lib/mermaid.test.ts`，`--maxWorkers=1`；目标文件 ESLint。
- `npm run check:version`；安装版本、双入口、包文件差异核对；修补后全量/生产锁文件审计仅记录依赖，不运行全量测试。
- 复用旧 helper 探针和既有 65 项验证的原范围；真实浏览器、R1/R2 与正式门禁未覆盖，另行确认。

### 2026-09-19 实施结果

core 是锁文件与本机安装唯一升级包，31 条消费关系均解析到 2.27.3，双模块产物哈希匹配官方包。用户追加批准的图片往返修复已落实。4 文件 49/49 回归通过、无跳过；目标 lint、局部类型和版本校验通过。双范围审计仍为同一公告的 32 moderate、0 high/critical，原始响应及范围差异保留。

矩阵覆盖：helper 行由 12 项双模块回归覆盖；编辑器行覆盖加载、同步、三类粘贴及两类拖放；往返行覆盖图片属性/相邻图片/相邻表格/公式/链接/HTML 表格及 Mermaid 两态；审计行由双范围 JSON 与公告归因核对覆盖。详见[实施证据](../../docs/验收证据/tiptap-patch-20260919T024351Z/README.md)。无构建、全量测试或真实浏览器，应用仍为 0.6.1。

## Review Notes

2026-09-19 单 Agent 自审已完成；补充仅宽度图片用例后 49/49 定向回归通过。详见[自审记录](../../docs/验收证据/tiptap-patch-20260919T024351Z/review.md)。无构建、全量测试、真实浏览器或发布，HEAD 与索引保持。

## Suggested Review Order

- 图片通过 schema 输出 HTML，普通图片保留 Markdown 与块分隔。
  [markdown-editor.tsx:72](../../src/components/markdown-editor.tsx#L72)

- 仅固定 core 官方 v2 回补。
  [package.json:81](../../package.json#L81)

- 查看双模块原型和 DOM 行为断言。
  [tiptap-security.test.ts:10](../../tests/lib/tiptap-security.test.ts#L10)

- 查看真实组件入口及往返保真。
  [markdown-editor-security.test.tsx:78](../../tests/components/markdown-editor-security.test.tsx#L78)

- 核对旧版失败、修复结果与验收边界。
  [README.md:1](../../docs/验收证据/tiptap-patch-20260919T024351Z/README.md#L1)
