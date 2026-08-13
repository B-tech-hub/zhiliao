# 0004. 表格以 GFM Markdown 存储，不支持合并单元格与列宽

日期：2026-08-12

状态：已采纳

## 背景

笔记正文以纯 Markdown 字符串存储（`notes.content`）。用户需要在编辑器中创建、编辑表格。TipTap 的 Table 扩展能力超出 Markdown 表达范围（合并单元格、列宽拖拽、单元格内多段落），需要为存储格式划定边界。

## 决策

表格以 GFM（GitHub Flavored Markdown）表格语法序列化进 Markdown。为保证序列化不退化，编辑器按 GFM 能力收敛交互：

1. 插入固定为"带表头行"的表格（`withHeaderRow: true`），满足 `tiptap-markdown` 对"首行全为表头"的 GFM 序列化前置条件。
2. 不开启合并单元格、不开启列宽拖拽（`resizable: false`）——两者 GFM 均无法表达。
3. 表格工具条不提供"上方加行"：在表头行上方插入普通行会破坏"首行全表头"结构。

## 备选方案与否决理由

1. **表格一律以内嵌 HTML 存储**：能表达合并单元格等全部能力，但正文充斥大段 HTML，搜索索引噪音大，第三方 Markdown 渲染器显示效果参差。否决。
2. **独立表格数据表 + 正文占位引用**：Markdown 纯净，但复制/导出丢数据、编辑器双数据源同步复杂，与 ADR 0002 的否决理由相同。否决。

## 权衡

- 若用户操作触及边界（如在表头行执行"删行"使首行变为普通行），`tiptap-markdown` 会将该表格退化为内嵌 HTML 存储（`html: true` 已开启）。数据不丢、编辑器仍可正常渲染与再编辑，仅存储形式不再是纯 Markdown，与 ADR 0002 图片属性内嵌 HTML 的取舍一致。
- GFM 表格是纯文本，AI 处理链路（整理、对话上下文）与 jieba 分词搜索均不受影响。

## 后果

- 新增依赖 `@tiptap/extension-table` / `-table-row` / `-table-header` / `-table-cell`（与主包同为 v2）。
- 笔记卡片摘要的 Markdown 符号过滤需包含 `|`，避免表格线残留（`note-card.tsx`）。
- 验收项：插入表格→编辑→自动保存→刷新重开，表格完整还原（Markdown 往返稳定）。
