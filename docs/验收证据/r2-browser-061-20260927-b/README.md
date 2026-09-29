# R2 浏览器补验记录：061-20260927-b

**结论：浏览器六项全部通过；结合 run d 的数据结果，判定 R2 本机同版本范围通过。** 本轮复用 run d 的镜像与 restore 实例，只执行一次浏览器矩阵，未重新构建、未改产品源码。机器结果见 [execution.json](execution.json) 与 [browser.json](browser.json)。

## 输入与现场

- 执行提交 `33b5203e238275093290834b5b4231a528bdde22`；本轮 `build_attempts = 0`，不重新构建。
- 复用本地标签 `zhiliao-r2:0.6.1-0a2819f37699` 与实际 image ID `sha256:f262652592dd2bd32d00aae44f60d4c98caa2c89ca0942254f77918f57aacb4a`；候选清单的 276 个文件逐个哈希核对通过。
- 只按精确容器 ID `b000881c42c1c8b91a9ddaf4bd587bf88edba2cda76885e9a5a263502f119481` 启停 run d 的 restore 实例，仍为 bridge 网络与 `127.0.0.1:3313` 绑定；source/import 及旧 run c 全程保持停止。
- 恢复库 `modelConfigured`、`weeklyReviewEnabled` 均为 false，容器环境也没有 `API_KEY`，真实模型预算为 0。

## 守卫修正

与 run a 的差异只有一处：守卫改为按只读语义放行产品既有的 `POST /api/notes/:id/related`，并单独记入 `readOnlyRequests`；其它非 `GET`/`HEAD` 请求仍一律中断，模型端点仍直接判失败。本轮 `readOnlyRequests` 只有 1 条相关笔记请求，`blockedRequests` 与 `modelRequests` 均为空，说明放行范围没有放宽到其它写请求。

## 实际结果

| 检查 | 结果 |
|---|---|
| 真实登录 | 通过；[首页](browser/01-home.png) |
| 短笔记恢复 | 通过；[短文](browser/02-short.png) |
| 长文、表格与 PNG | 通过：表格值 `42`、PNG 96×64，页面同源 `fetch` 返回 200、`image/png`、389 字节，SHA-256 与源快照一致；[现场](browser/03-long-png.png) |
| HEIC 展示图与字节 | 通过：200、`image/jpeg`、96×64、1997 字节，SHA-256 与源快照的 JPEG 副本一致；[现场](browser/04-heic-jpeg.png) |
| 搜索并打开结果 | 通过：关键词命中并跳转到目标笔记；[现场](browser/05-search.png) |
| 历史会话与来源 | 通过：固定合成历史与来源集 1 正确显示；[现场](browser/06-history-source.png) |

浏览器矩阵于北京时间 20:21:49 至 20:21:56 只执行一次；恢复实例 20:21:43 启动、20:21:56 停止。`pageErrors`、`consoleErrors`、`failedResponses`、`blockedRequests`、`modelRequests` 全部为空，六张截图均在入场动画结束后采集。

## 现场与归档

- 18 份原始输出逐字节归档，包括六张截图、`browser.json`、两份资源快照、旧证据前后哈希与恢复实例日志；临时现场与归档字节一致。
- 凭据扫描：本次两份临时密码/密钥值在归档文件的 UTF-8 与 UTF-16LE 两种编码下都没有匹配。
- 收尾核对：恢复实例停止后与正式 `zhiliao` 容器及旧 run c/d 容器逐字段一致，九卷未变，旧证据 534 个文件哈希前后相同；run a 的证据目录未被改动。

## 边界

本结论只覆盖本机、同版本的单次浏览器补验与 run d 的数据恢复，不覆盖异地恢复、0.6.0 升级回退、独立 Linux、arm64、无缓存分发、RC 或正式发布，也不覆盖 0.6.1 的完整发布门禁。
