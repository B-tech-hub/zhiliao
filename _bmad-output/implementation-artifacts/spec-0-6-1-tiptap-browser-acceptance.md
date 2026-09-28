---
title: '0.6.1 TipTap 补丁真实浏览器验收'
type: 'chore'
created: '2026-09-28'
status: 'in-progress'
baseline_commit: '40ac9d7b4ccb8e824e9dccabb19849c8c249cbb2'
review_loop_iteration: 0
context:
  - '{project-root}/docs/TipTap残余风险调查-2026-09-19.md'
  - '{project-root}/docs/验收证据/r2-browser-061-20260927-b/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `@tiptap/core 2.27.3` 补丁及图片序列化修复只有 jsdom 组件回归（26/26）作为证据。真实浏览器中，用工具条设置宽度/对齐、自动保存、重开后属性是否保留，以及图片紧邻表格时的往返，都还没有验证过。发布说明中这一项仍标注为未验收。

**Approach:** 使用 R2 已通过的候选镜像 `zhiliao-r2:0.6.1-0a2819f37699`。该镜像的清单已包含 `package.json`、`package-lock.json` 和 `markdown-editor.tsx`，哈希与当前 HEAD 一致，因此不需要重新构建。新建一个隔离实例，只绑定 `127.0.0.1` 的一个空闲端口，用 Playwright 真实 Chromium 分别在 Mermaid 关闭和开启两种状态下各跑一轮编辑矩阵，每项核对页面 DOM、数据库正文和重开后的结果。

## Boundaries & Constraints

**Always:** 单 Agent 执行。只用合成数据和 R2 fixture 中的 PNG，真实模型预算为 0：不配置任何模型，容器环境中不出现 API_KEY。所有浏览器请求都要记录。允许的写请求仅限本实例的 `PATCH /api/notes/:id`、`POST /api/notes`、`POST /api/uploads`、登录，以及只读语义的 `POST /api/notes/:id/related`；其他写请求和所有模型请求一律判失败。正式实例只允许用 `docker ps` 和 `docker inspect` 做前后只读比对，禁止 `docker exec`。浏览器矩阵只跑一次，任何一步失败即停止并保留现场。证据归档到 `docs/验收证据/tiptap-browser-061-<run>/`，归档中不含 env 和密码。

**Ask First:** 需要重新构建镜像、修改产品源码、第二次运行，或删除卷/旧资源时，先问我。如果发现真实缺陷，先报告证据，不要顺手修复。

**Never:** 不碰正式容器或 `./data/db`；不推送、不打 tag；不跑全量门禁；不复用或改动 R2、升级彩排的现场与卷；不把本轮结论写成 XSS 全面安全证明，也不写成 RC 已通过。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 宽度+居中保存重开 | 空笔记，上传 PNG，通过工具条点「50%」「居中」，等待保存完成后刷新页面 | DB 正文包含 `<img` 且 `width="50%"`、居中样式；重开后 DOM 中 img 的 `width=50%`，`margin-left`/`margin-right` 为 auto；图片请求返回 200 | 属性丢失即判失败 |
| 仅宽度 / 仅右对齐 | 两张图分别只设 75% 或只设右对齐 | 各自只保留对应的属性，另一属性为空；重开后结果一致 | 同上 |
| 普通图片 | 不做任何设置的图片 | DB 中为 Markdown `![..](/api/images/..)`，不含 `<img` | 同上 |
| 图片紧邻表格 | fixture 通过 API 写入「带宽度的 img 后面直接跟 GFM 表格」的正文，浏览器打开后编辑表格单元格，保存后重开 | 表格行列数与单元格内容正确，编辑后的值已保存；图片属性仍在；DB 正文中不出现表头与图片粘在同一行 | 同上 |
| 危险属性 | fixture 写入含 `onerror`、`__proto__` 键或 `style` 注入的 img HTML | 页面 DOM 中不出现 on* 属性，也不执行脚本（不触发 dialog，页面无报错）；正常内容照常显示 | 出现即判失败 |
| Mermaid 两态 | 以上五项在 `feature_mermaid_enabled` 为 0 和 1 时各跑一轮 | 两轮结果都满足以上期望 | 同上 |

</frozen-after-approval>

## Code Map

- `src/components/markdown-editor.tsx:71-110` -- RichImage：有宽度或对齐时用 `getHTMLFromFragment` 输出 `<img>`，否则输出 Markdown，最后 `closeBlock`；width/align 的 parse 与 render 在 92-107 行。
- `src/components/markdown-editor.tsx:218-251` -- ImageToolbar：宽度 50%、75%、100%、原始，对齐左、中、右，按钮以 title 标识（如 `宽度 50%`、`居中`）。
- `src/app/(app)/notes/[id]/note-editor.tsx:131-170` -- 正文编辑后 2 秒防抖，经 `PATCH /api/notes/:id` 保存，有 saveState；另外有 900ms 后的 related 只读请求。
- `src/app/(app)/notes/[id]/page.tsx:39` -- mermaid 开关来自 `feature_mermaid_enabled`（`src/lib/feature-flags.ts:13`），可在启动前用 SQLite 设置。
- `tests/components/markdown-editor-security.test.tsx:79-171` -- jsdom 回归的断言形状，浏览器断言按它对齐，不重复跑。
- `docs/验收证据/r2-browser-061-20260927-b/{browser-check.cjs,run-browser.py}` -- 请求守卫、失败即停、报告与截图的写法；Playwright 模块在 `%LOCALAPPDATA%/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright`，Chromium 为 `ms-playwright/chromium-1194`。复制这两个脚本后改造，守卫改为上面 Always 中的写白名单。
- `docs/验收证据/upgrade-060-061-20260927-a/tools/{compose.yml,run.ps1}` -- 隔离 project、卷、资源前后快照和凭据生成的写法；本轮只需要一个角色，外加 ui 端口覆盖（参照 R2 的 `ui.yml`）。

## Tasks & Acceptance

**Execution:**
- [ ] `docs/验收证据/tiptap-browser-061-<run>/tools/` -- 复制并改造 compose、fixture（init 关闭每周回顾并设置 mermaid 开关，seed 写入相邻表格与危险属性两条笔记）、browser-check 和总控脚本 -- 让步骤可复现
- [ ] 同一目录 -- 核对镜像 ID、端口空闲和资源前置快照 → mermaid=0 轮 → 停止实例、切换开关 → mermaid=1 轮 → 停止实例并做资源后置快照 -- 执行矩阵
- [ ] 同一目录 -- 归档 report、截图、每项对应的 DB 正文摘录和日志，做凭据扫描，写 README -- 留证
- [ ] `docs/TipTap残余风险调查-2026-09-19.md`、`docs/releases/v0.6.1.md`、`docs/产品规划/开源发布范围与执行清单-2026-09-13.md`、`docs/README.md`、`CHANGELOG.md` -- 如实同步结果后本地提交 -- 满足文档同步规则

**Acceptance Criteria:**
- Given 矩阵执行完毕，when 核对 report，then 两轮共 10 项都有 DOM 断言、DB 正文断言和截图；pageErrors、modelRequests、blockedRequests 均为空；只有全部通过才能记为「TipTap 补丁真实浏览器验收本机通过」。
- Given 任一步失败，when 收尾，then 停止实例、保留卷，不重试，文档写明失败点。
- Given 收尾，when 做前后比对，then 正式容器身份与挂载、非本轮卷清单都与之前一致。

## Verification

**Commands:**
- 总控脚本 -- expected：退出码 0，stages 全部为 passed
- `node --check` 与 PowerShell 解析器检查 -- expected：执行前无语法错误

**Manual checks:**
- 抽查截图，确认居中、右对齐和表格可见；README 逐行对照矩阵。

## 执行记录

- run `t061-20260928-a`：m0 轮的前 5 项全部通过；「危险属性」一项因脚本把缺失图片的状态码预期为 404（实际为 400）而失败并停止，m1 轮未执行。这是工具缺陷，不是产品缺陷，详见[运行记录](../../docs/验收证据/tiptap-browser-061-20260928-a/README.md)。run b 须经用户确认后才能执行。
