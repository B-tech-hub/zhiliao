---
title: '0.6.1 TipTap 补丁真实浏览器验收'
type: 'chore'
created: '2026-09-28'
status: 'done'
baseline_commit: '40ac9d7b4ccb8e824e9dccabb19849c8c249cbb2'
review_loop_iteration: 0
last_updated: '2026-09-28'
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
- [x] `docs/验收证据/tiptap-browser-061-<run>/tools/` -- 复制并改造 compose、fixture（init 关闭每周回顾并设置 mermaid 开关，seed 写入相邻表格与危险属性两条笔记）、browser-check 和总控脚本 -- 让步骤可复现
- [x] 同一目录 -- 核对镜像 ID、端口空闲和资源前置快照 → mermaid=0 轮 → 停止实例、切换开关 → mermaid=1 轮 → 停止实例并做资源后置快照 -- 执行矩阵
- [x] 同一目录 -- 归档 report、截图、每项对应的 DB 正文摘录和日志，做凭据扫描，写 README -- 留证
- [x] `docs/TipTap残余风险调查-2026-09-19.md`、`docs/releases/v0.6.1.md`、`docs/产品规划/开源发布范围与执行清单-2026-09-13.md`、`docs/README.md`、`CHANGELOG.md` -- 如实同步结果后本地提交 -- 满足文档同步规则

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

- run `t061-20260928-a`：m0 轮的前 5 项全部通过；「危险属性」一项因脚本把缺失图片的状态码预期为 404（实际为 400）而失败并停止，m1 轮未执行。这是工具缺陷，不是产品缺陷，详见[运行记录](../../docs/验收证据/tiptap-browser-061-20260928-a/README.md)。当时 run b 须经用户确认后才能执行；后续已存在的 run b 结果与本次收尾核对见下文。

## 2026-09-28 文档收尾与矩阵核对

本次用户明确要求接续已有 run b 证据、同步文档和状态并列出 R3 门禁。沿用现有工作区，单 Agent 只读核对证据后更新文档；未启动浏览器、容器、构建、全量门禁或模型请求。保留原 `baseline_commit` 和冻结块，不把文档收尾解释为新的运行授权。本规格为独立工作包，未绑定 Epic/Story，不修改 `sprint-status.yaml` 的完成数量或 Story 2.2 的 `review` 状态。

- [run b](../../docs/验收证据/tiptap-browser-061-20260928-b/README.md)：两轮各 1 次、各 7 项（登录 + 6 项业务检查）全部 passed，共 14 项；12 张截图齐全，10 条保存后的正文与各轮导出一致，危险输入的原正文保留。原验收标准的“10 项”按两态下的五类场景计数，其中“仅宽度 / 仅右对齐”实际拆成两项，不能把 14 项写成 14 类独立功能。
- 候选 276 个文件哈希匹配；image ID、两态设置、资源快照、运行时工具包和凭据扫描的核对见[收尾核对](../../docs/验收证据/tiptap-browser-061-20260928-b/closeout-review.md)。图片居中、右对齐和表格截图已人工抽查。
- run a 的失败及原始 JSON 保留。run b 的唯一可执行逻辑变化是缺失图片状态预期从 404 改为 400，另有两处说明性注释变化；未修改产品源码。

**状态保持 `in-progress`。** 已执行矩阵通过，但下列原规格要求尚无完整证据，执行矩阵任务不勾选完成：

1. 冻结矩阵要求以“带属性图片紧邻 GFM 表格”为输入，实际 seed 是 `<img …><table>…</table>`。现有证据证明 HTML 表格编辑后导出为 GFM 并重开成功，未覆盖 GFM 初始输入。
2. 冻结约束要求“所有浏览器请求都要记录”。现有 JSON 保存了写请求、相关笔记请求和异常分类，正常 GET/HEAD 与登录没有逐请求日志。守卫数组为空不等于完整请求归档，不能事后补造。

以上为验证覆盖缺口，未证明产品出现新的缺陷。后续最小补验需先确定 GFM 输入及正常请求记录方式，再按原 Ask First 约束确认运行；不修改旧工具或旧报告来消除缺口。R3 剩余清单见[发布门禁](../../docs/产品规划/开源发布范围与执行清单-2026-09-13.md#r3-remaining-gates)。

## run c 准备（2026-09-28）

用户已明确授权准备 run c：补 GFM 初始输入、完整请求元数据并做脚本静态检查，先不启动容器或浏览器。准备基线为 `fbf2497ab01e949a8bab890b1516505cea42b688`；原 `baseline_commit`、冻结块和 Story/Sprint 保留。此次授权只覆盖工具准备，不是再次运行授权。

准备目录：[tiptap-browser-061-20260928-c](../../docs/验收证据/tiptap-browser-061-20260928-c/README.md)。复制 run b 的必要工具及 PNG，历史工具不改。新 seed 为 `<img …>\n\n| 表头 | 数值 |…`，空行只终止 HTML 图片块，图片与 GFM 表格间不插入段落；编辑前验证数据库正文仍等于 GFM seed。

请求记录器在路由和第一页之前注册 BrowserContext 事件，逐条记录开始、守卫决定、响应状态与完成/失败。仅存固定元数据，不记录头、Cookie、正文、查询串及 URL 用户信息；本轮临时凭据另行脱敏。关闭浏览器后核对每个请求的结束记录、成功登录和普通读取记录及文件哈希；缺失时总结果失败，不能用业务矩阵的 passed 掩盖日志缺口。

准备完成标准：

- [x] 三份 JS 语法、PowerShell AST 和 Compose YAML 静态解析通过。
- [x] GFM 种子、请求记录字段与监听/收尾接线静态审阅通过。
- [x] 编码、文档链接、276 个候选输入及历史文件保护检查通过。
- [x] 运行矩阵未执行，未生成 passed 报告，两个运行缺口保留，状态继续 `in-progress`。

后续获准后，按准备说明在新 project 上仅执行一次两态矩阵；不重建镜像，失败即停、保留现场。工具语法通过不能代替 GFM 编辑往返或真实请求事件完整性验收。

## run c 执行与缺口关闭（2026-09-28）

用户授权后按 [run c 工具与说明](../../docs/验收证据/tiptap-browser-061-20260928-c/README.md)在全新隔离实例上执行一次两态矩阵（单 Agent，零真实模型，不构建、不拉取）。**run b 遗留的两个覆盖缺口已关闭，本规格状态改为 `done`。**

- 两轮各 7 项（登录 + 6 项业务）全部 `passed`，共 14 项；12 张截图齐全；页面错误、异常响应、额外写请求、模型请求与弹窗数组均为空；总控退出码 0，`stages` 全部 `passed`，无重试。
- 缺口 1（GFM 初始输入）：两态编辑前的详情正文即为 GFM 表格 seed，格式记录为 `GFM`；编辑单元格保存重开后仍为 GFM 表格，图片保持 `width="50%"` 且与表格不粘行。
- 缺口 2（全部请求记录）：每轮独立 `requests-mN.jsonl`，逐请求记录开始、守卫决定、响应状态与完成/失败；未结束 ID 与记录错误均为 0，成功登录与普通读取均有记录；唯一非 200 是刻意引用的缺失图片 400，`requestfailed` 均为关闭浏览器时的真实取消。
- 核对与边界见[收尾核对](../../docs/验收证据/tiptap-browser-061-20260928-c/closeout-review.md)与 [closeout-check.json](../../docs/验收证据/tiptap-browser-061-20260928-c/closeout-check.json)：归档逐字节比对一致、凭据扫描 0 命中、正式容器前后一致。

**此前「2026-09-28 文档收尾与矩阵核对」一节中「状态保持 `in-progress`」的结论，已由本节的 run c 结果取代；该节记录其当时证据，不再代表当前状态。** 本规格的 `done` 只表示该浏览器专项的覆盖要求已满足，不表示 R3 剩余门禁（候选定稿、完整四条门禁、无缓存/双架构、RC、正式发布）已通过，也不改变 Story 2.2 的 `review` 状态。冻结块、原 `baseline_commit` 与历史执行记录保留。