# TipTap run c 准备与待执行方案

日期：2026-09-28。**状态：工具已准备，容器与浏览器未启动，两个运行覆盖缺口仍未关闭。** 本次用户只授权修改验收工具、同步文档和静态检查。准备基线提交为 `fbf2497ab01e949a8bab890b1516505cea42b688`，接续[原规格](../../../_bmad-output/implementation-artifacts/spec-0-6-1-tiptap-browser-acceptance.md)与[run b 收尾核对](../tiptap-browser-061-20260928-b/closeout-review.md)。

## 已准备的改动

| 文件 | 改动 |
|---|---|
| [fixture.cjs](tools/fixture.cjs) | 将表格种子改为带宽度的 HTML 图片紧邻 GFM 表格；种子写入前断言没有 HTML table 标签，GFM 表头、分隔行和数据行完整 |
| [browser-check.cjs](tools/browser-check.cjs) | 浏览器和详情接口双重核对首次打开的 GFM 种子；编辑单元格、等待保存、重开和属性断言沿用 run b。注册请求记录器后才建立页面，守卫放行和拦截都记入日志 |
| [request-recorder.cjs](tools/request-recorder.cjs) | 用 BrowserContext 事件记录全部请求生命周期，逐事件写入 JSONL；关闭浏览器后核对结束事件，并关联日志 SHA-256 |
| [run.ps1](tools/run.ps1) | 只接受 `t061-20260928-c`；启动前核对固定清单和 276 个文件哈希，继续使用原镜像 ID、回环端口、独立 project 与三卷 |
| [compose.yml](tools/compose.yml)、[pattern.png](tools/fixtures/pattern.png) | 复用 run b 的隔离配置和 PNG；只复制本轮需要的夹具 |

原 run a/b 的工具、日志、报告与截图均未改动。本轮新工具为 UTF-8、LF；`run.ps1` 保留 UTF-8 BOM，保证 Windows PowerShell 5.1 正确读取中文。

## GFM 初始输入

实际地址由本轮上传接口返回，正文结构固定为：

```markdown
相邻表格口令：m0。

<img src="/api/images/本轮图片.png" width="50%" alt="戊">

| 表头 | 数值 |
| --- | --- |
| 内容 | 42 |

尾段。
```

图片与表格之间只有 Markdown 块分隔空行，没有中间段落。该空行用于结束 HTML 图片块；不能把 GFM 表格拼在 `<img>` 同一行或其未结束的 HTML 块里。m1 使用同样结构。浏览器必须在编辑前核对详情正文仍与 seed 相同，再验证两行两列；编辑后数据库正文与重开页面都必须出现“内容改 / 42”，图片仍为 50%。

## 请求元数据契约

每轮生成独立的 `requests-m0.jsonl` 或 `requests-m1.jsonl`；文件已存在时拒绝覆盖。这些文件本次尚未生成。

| 事件 | 固定记录字段（另有 sequence、requestId、event、UTC time） |
|---|---|
| request | method、origin、pathname、resourceType、navigation、redirectedFrom |
| guard | decision：普通读取、登录、相关笔记、PATCH 或拦截分类 |
| response | status |
| requestfinished / requestfailed | status（未收到响应时为 null）、elapsedMs |

- 正常 GET/HEAD、登录、静态资源、详情读取、相关笔记、PATCH、重定向以及失败请求都通过同一个记录器。记录器在路由与第一页之前注册，作用于整个 BrowserContext；Service Worker 仍禁用。
- 不读取或记录请求/响应头、Cookie、Authorization、请求/响应正文、URL 查询串、片段及用户信息；路径和 origin 中的本轮临时密码/密钥也会脱敏。非 HTTP 地址只保留协议名，省略可能包含正文的路径；错误事件不保存可能带响应片段的原始错误文本。
- 日志只新增观测，不放宽原请求守卫。缺失图片 400 仍单列预期，HTTP 400 在请求生命周期中属于已收到响应，并不等于 `requestfailed`。
- 关闭浏览器后汇总 `requestMetadata`：请求/事件/完成/失败数量、未结束 ID、记录错误、正常读取与登录是否有记录、日志 SHA-256。关闭时的真实取消事件也会记录，不伪造结束事件。
- 记录失败、缺结束事件、成功请求没有响应状态，或成功矩阵缺登录/读取记录，均令本轮失败。成功或失败的已有业务报告和请求日志一起保留；没有日志时不能仅凭业务检查通过关闭规格。
- 本轮只做语法与结构检查；Playwright 实际事件顺序、文件落盘和关闭时事件完整性，必须由后续获准运行验证。

## 待执行范围与停止条件

后续仍需用户明确确认，才可运行以下命令；本次没有执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\docs\验收证据\tiptap-browser-061-20260928-c\tools\run.ps1 -RunId t061-20260928-c
```

- 镜像固定 `zhiliao-r2:0.6.1-0a2819f37699`，image ID 固定 `sha256:f262652592dd2bd32d00aae44f60d4c98caa2c89ca0942254f77918f57aacb4a`，不构建、不拉取。
- project 为 `zhiliao-t061-20260928-c`，端口为 `127.0.0.1:3321`；运行前检查端口和本轮资源名称未占用，不停止其他实例来腾端口。临时目录为 `%TEMP%/zhiliao-t061-20260928-c`，已存在则停止，不覆盖。
- 单 Agent、合成笔记、零真实模型；Mermaid 两态各一次，预计共 14 项检查（含两次登录）。日志覆盖本轮完整矩阵，旧轮日志不补造。
- 任何业务断言或日志完整性检查失败即停止并保留卷；不改产品源码、不自动重试、不删除旧资源。正式实例仅用 ps/inspect 核对原定身份与挂载，禁止 exec。
- 后续归档需要复制请求 JSONL、两轮报告、正文摘录、截图、阶段和资源快照，并核对日志哈希、临时凭据未泄漏、资源保护和每行规格覆盖。只有补验通过并完成审查后，才能关闭原规格；不扩展为全站 XSS、RC 或正式发布结论。

## 准备阶段验收

- [x] 三份 JavaScript 工具 `node --check`、PowerShell AST 与 Compose YAML 静态解析。
- [x] GFM 种子语法和日志固定字段、监听顺序、完整性断言的静态审阅。
- [x] 新文件编码、文档链接、候选输入与历史文件哈希检查。
- [x] 本次未生成运行报告、未启动容器/浏览器；原规格保持 `in-progress`。

R3 下一步仍见[剩余发布门禁](../../产品规划/开源发布范围与执行清单-2026-09-13.md#r3-remaining-gates)。

静态结果见 [preparation-check.json](preparation-check.json)：三份 JS 语法、PowerShell AST、Compose 解析通过；从真实 fixture 的语法树提取两态种子，用现有 markdown-it 静态解析为相邻图片块与两行表格。日志四处输出的字段白名单、监听顺序和完整性检查接线已串行审阅；未运行记录器的动态事件测试。276 个候选输入匹配，其余 1,542 份基线文件未变。
