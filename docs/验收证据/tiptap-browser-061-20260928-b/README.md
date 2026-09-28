# TipTap 补丁真实浏览器验收 run t061-20260928-b

**运行结论：已执行矩阵通过（仅限本机），原规格尚有覆盖缺口。** Mermaid 关闭（m0）和开启（m1）各跑一轮，每轮 7 项检查（登录 + 6 项矩阵），共 14 项，一次全部通过。本轮在全新实例上执行，没有复用 [run a](../tiptap-browser-061-20260928-a/README.md) 的现场。和 run a 相比，可执行逻辑仅将缺失图片的预期状态码从 404 改为 400，另有两处说明性注释变化；其他工具逐字节相同。规格见 [spec-0-6-1-tiptap-browser-acceptance](../../../_bmad-output/implementation-artifacts/spec-0-6-1-tiptap-browser-acceptance.md)。

## 输入

- 镜像：`zhiliao-r2:0.6.1-0a2819f37699`，ID 为 `sha256:f262652592dd2bd32d00aae44f60d4c98caa2c89ca0942254f77918f57aacb4a`，是 R2 与升级彩排用过的同一镜像，本轮没有重新构建。镜像的构建输入里已包含 `@tiptap/core 2.27.3` 和 `markdown-editor.tsx`，哈希与 HEAD 一致。
- 实例：project 为 `zhiliao-t061-20260928-b`，只开放 `127.0.0.1:3321`。未配置任何模型，关闭每周回顾，正文全部为合成数据，图片由 fixture 通过真实上传接口写入。
- 浏览器：Chromium 141.0.7390.37，Playwright 1.64.0-alpha。
- 执行时间：2026-09-28 13:58:34–13:59:40 +08:00，各阶段记录见 [stages.jsonl](stages.jsonl)。

## 矩阵结果（m0 与 m1 两轮结果相同）

| 检查 | 结果 | 截图（m0 / m1） |
|---|---|---|
| 用工具条设置 50% 宽度并居中，保存后刷新 | 数据库中为 `<img … width="50%" style="display: block; margin-left: auto; margin-right: auto;">`；重开后 DOM 属性一致 | [m0](browser/m0-01-center.png) / [m1](browser/m1-01-center.png) |
| 只设宽度 75% | 只有 `width="75%"`，没有 style | [m0](browser/m0-02-width.png) / [m1](browser/m1-02-width.png) |
| 只设右对齐 | 只有 `style="display: block; margin-left: auto;"`，没有 width | [m0](browser/m0-03-right.png) / [m1](browser/m1-03-right.png) |
| 普通图片 | 编辑正文后，图片仍保存为 `![丁](…)` 且不含 `<img` | [m0](browser/m0-04-plain.png) / [m1](browser/m1-04-plain.png) |
| 图片紧邻 HTML 表格 | 输入为 `<img …><table>…</table>`；编辑单元格后保存再打开，表格为 `[表头,数值],[内容改,42]`，图片保持 50%；图片单独占一行，GFM 表头完整 | [m0](browser/m0-05-table.png) / [m1](browser/m1-05-table.png) |
| 危险属性 | 测试内容包括 `onerror`、`onload`、`data-pm-slice` 中的 `__proto__`、`style` 中的 `javascript:`，以及 javascript 链接。结果：`window.__xss` 为 null，DOM 中 on* 属性为 0，javascript 链接为 0；style 被规范化为白名单居中样式，正常图片保持 50% 并居中 | [m0](browser/m0-06-danger.png) / [m1](browser/m1-06-danger.png) |

前五项保存后的正文断言见 [browser-m0.json](browser-m0.json) 和 [browser-m1.json](browser-m1.json) 中的 `dbChecks`，也见 fixture 导出的 [evidence/db-content-m0.json](evidence/db-content-m0.json) 和 [evidence/db-content-m1.json](evidence/db-content-m1.json)。

危险属性一项只验证渲染，不编辑或保存；两份 `db-content` 均保留原始危险输入，不能据此宣称数据库正文已被清洗。

## 请求守卫

- 每轮放行了 5 次对本轮笔记的 `PATCH` 自动保存，以及 6 次相关笔记只读请求。
- `pageErrors`、`consoleErrors`、`failedResponses`、`blockedRequests`、`modelRequests`、`dialogs` 全部为空。
- 预期项只有缺失图片 `missing-xss.png` 的 400 响应，以及它对应的一条控制台报错，单独记录在 `expectedMissing`。

## 资源与保护

- 实例已停止，3 个卷保留；应用日志中没有 error。
- 正式容器 `zhiliao` 只执行了 ps/inspect，没有执行 exec；它的身份、挂载以及非本轮卷的清单，前后一致（`stop` 阶段已校验）。
- 运行时的工具包与 [tools/](tools/) 逐字节一致。归档中不包含 `app.env`，扫描临时密码和密钥没有命中。

## 边界

原规格的 GFM 初始输入与全部请求日志尚未覆盖，具体差异见[收尾核对](closeout-review.md)；规格保持 `in-progress`。

本轮只证明：在本机 linux/amd64 候选镜像上，真实浏览器中图片宽度、对齐的保存与重开，以及图片紧邻 HTML 表格、编辑后转为 GFM 并重开的往返，都正确，所列危险属性也没有生效。以下内容不在本轮证明范围内：全站 XSS 安全、剪贴板粘贴专项、异地部署、独立 Linux、arm64、RC 与正式发布。此前已经丢失的图片属性，也不会因此自动恢复。
