# R2 浏览器补验记录：061-20260927-a

**结论：本轮在“长文表格与 PNG”用例处停止，R2 仍未通过。** 停止原因是验收脚本自身的请求守卫过严：它按请求方法判定，把产品既有的只读 `POST /api/notes/:id/related` 当成“额外写请求”中断。这不是产品缺陷——同一用例的[截图](browser/03-long-png.png)显示长文正文、公式、表格和 PNG 全部正常渲染，PNG 字节也与源快照一致。恢复实例已停止，正式实例与旧证据前后核对通过。机器结果见 [execution.json](execution.json) 与 [browser.json](browser.json)。

## 输入与现场

- 执行提交：`b7d50f9a56d68dfcd68c77dc98cf7dd6075c55ac`；本轮 `build_attempts = 0`，不重新构建。
- 候选清单 `0a2819f376993fafa61b27f57a9a978ff7ef1c7635d88e8485bee7c0655c7baf` 的 276 个文件逐个哈希核对通过。
- 复用本地标签 `zhiliao-r2:0.6.1-0a2819f37699` 与实际 image ID `sha256:f262652592dd2bd32d00aae44f60d4c98caa2c89ca0942254f77918f57aacb4a`。
- 只按精确容器 ID `b000881c42c1c8b91a9ddaf4bd587bf88edba2cda76885e9a5a263502f119481` 启停 run d 的 restore 实例，仍为 bridge 网络与 `127.0.0.1:3313` 绑定；source/import 及旧 run c 全程保持停止。
- 前置保护快照（容器身份、卷列表、挂载、端口和旧证据 516 个文件哈希）在运行前后完全一致，见 [protection-check.json](protection-check.json)。

## 实际结果

| 检查 | 结果 |
|---|---|
| 真实登录 | 通过；[首页](browser/01-home.png) |
| 短笔记恢复 | 通过；[短文](browser/02-short.png) |
| 长文、表格与 PNG | 页面部分通过：表格值 `42`、PNG 96×64 可见，页面同源 `fetch` 返回 200、`image/png`、389 字节，SHA-256 与源快照一致；随后被守卫中断用例，[现场](browser/03-long-png.png) |
| HEIC 展示图与字节、搜索跳转、历史会话与来源 | 未执行 |

浏览器矩阵于北京时间 20:08:12 至 20:08:16 只执行一次；恢复实例 20:08:06 启动、20:08:16 停止。`pageErrors`、`failedResponses`、`modelRequests` 均为空，唯一的 `consoleErrors` 项是本轮守卫主动 abort 请求产生的 `net::ERR_FAILED`。脚本语法、镜像身份、端口和无真实模型预算的边界都在运行前核对通过，见 [browser-check.cjs](browser-check.cjs)、[run-browser.py](run-browser.py) 与 [restore-app.log.txt](restore-app.log.txt)。

## 停止原因

守卫只放行 `GET`/`HEAD` 与登录 `POST`，其余方法一律中断。笔记编辑器在正文稳定 900 ms 后固定发出 `POST /api/notes/${note.id}/related`（[note-editor.tsx](<../../../src/app/(app)/notes/[id]/note-editor.tsx#L110>)）。该接口只做候选召回和可选的冲突判断（[route.ts](../../../src/app/api/notes/[id]/related/route.ts)），不写库，是产品既有行为，也是 run d 脚本未拦截的请求；本次新增的按方法判定把它误判成写请求。失败用例中的 console error 与 `blockedRequests` 记录都由这次主动中断产生，不是产品异常。

恢复库中 `modelConfigured = false`、`weeklyReviewEnabled = false`，恢复容器的环境变量也没有 `API_KEY`，所以该请求即使放行也不会产生真实模型调用；放行后仍应把“无模型请求”保留为断言。

## 现场与归档

- 16 份原始输出逐字节归档，包括四张截图、`browser.json`、两份资源快照、旧证据前后哈希与恢复实例日志；未改动 run d 的脚本、结果和截图。
- 凭据扫描：本次两份临时密码/密钥值在归档文件的 UTF-8 与 UTF-16LE 两种编码下都没有匹配。
- 收尾核对：恢复实例停止后与正式 `zhiliao` 容器及旧 run c/d 容器逐字段一致，九卷未变。

本轮只覆盖本机、同版本、单次浏览器补验，不构成 R2 通过，也不改动 run d 的数据结论。

## 下一步

守卫需要按“只读语义”而不是“请求方法”放行 `POST /api/notes/:id/related`，同时保留模型请求断言，然后在新的证据目录重做一次完整浏览器矩阵。这次修正与新一轮执行需要另行确认，本轮按计划停止，不自动修复或重跑。
