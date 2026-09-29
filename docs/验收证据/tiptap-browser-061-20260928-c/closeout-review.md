# TipTap run c 收尾核对

日期：2026-09-28。核对基线提交：`fbf2497ab01e949a8bab890b1516505cea42b688`（准备），执行时 HEAD 为 `26bd61c8237381472c9a7058da846314ece54b1a`。本次为**单 Agent 串行自审**：由用户授权执行 run c 矩阵一次，随后只读核对产出物并同步文档，未重跑矩阵、未构建、未跑完整门禁、未发送任何模型请求。

**结论：run b 遗留的两个覆盖缺口已由 run c 补齐，原规格可以关闭。** 缺口定义见 [run b 收尾核对](../tiptap-browser-061-20260928-b/closeout-review.md)。

## 缺口关闭核对

| 原缺口 | run c 证据 | 判定 |
|---|---|---|
| 矩阵要求「带属性图片紧邻 **GFM 初始表格**」，run b 实际用 HTML 表格 | 两态 `tableInitial.format` 为 `GFM`，编辑前正文与 seed 逐字相等；编辑 `内容 → 内容改` 后保存重开，数据库正文仍为 GFM 表格 `[表头,数值],[内容改,42]`，图片保持 `width="50%"` 且与表格不粘行 | 已覆盖 |
| 原约束要求「所有浏览器请求都要记录」 | 每轮独立 `requests-mN.jsonl`，request/guard 计数与请求数相等；未结束 ID 与记录错误均为 0；成功登录与普通读取均有记录；日志 SHA-256 随报告归档 | 已覆盖 |

## 逐项核对

| 项目 | 核对结果 |
|---|---|
| 总控执行 | 退出码 0，[stages.jsonl](stages.jsonl) 六个阶段（preflight/start/round-m0/round-m1/stop）全部 `passed`，无重试（`attempts=1`） |
| 矩阵结果 | m0、m1 各 7 项（登录 + 6 项业务）全部 `passed`，共 14 项；12 张截图齐全；`pageErrors`、`consoleErrors`、`failedResponses`、`blockedRequests`、`modelRequests`、`dialogs` 全为空 |
| 保存后正文 | 每轮 5 条 `dbChecks` 与 fixture 导出的 `db-content` 逐字一致；普通图片仍为 Markdown，带属性图片仍为 HTML，表格值为 `内容改 / 42` |
| 危险输入 | 两份导出仍等于各自 seed 的危险正文；渲染为 `xss=null`、on* 属性 0、javascript 链接 0，合法宽度与居中保留。未测试危险正文的编辑保存或剪贴板粘贴 |
| 请求日志 | m0 567 请求 / 2264 事件 / 516 完成 / 51 失败；m1 568 / 2268 / 511 / 57；未结束 ID 与记录错误均为 0。每轮唯一非 200 的 response 是刻意引用的 `400 /api/images/missing-xss.png` |
| 失败事件性质 | `requestfailed` 均为关闭浏览器时的真实取消：m0 为 47 条已收到 200 响应 + 4 条无响应，m1 为 53 + 4；不是服务器错误，也未伪造结束事件 |
| 守卫决定 | 每条 request 都有 guard 记录：m0 为 555 允许读取 + 1 允许登录 + 6 相关笔记 + 5 PATCH；m1 为 556 / 1 / 6 / 5；没有新增放行或拦截分类 |
| 输入身份 | preflight 逐一比对 276 个候选输入哈希通过；归档 `image.json` 的 ID 为 `sha256:f262652592dd2bd32d00aae44f60d4c98caa2c89ca0942254f77918f57aacb4a`（linux/amd64 本机 image ID，不是 GHCR manifest digest） |
| 资源保护 | `resources-before.txt` 与 `resources-after.txt` 字节相同，覆盖正式容器身份、挂载与非本轮卷清单；正式实例只用 ps/inspect，未 exec；本轮不删除旧卷（a/b 的六个卷保持原样） |
| 凭据与归档 | 两项临时凭据仅内存读取；对全部归档文件（UTF-8）扫描命中 0 处，未输出值，不归档 `app.env`；归档证据与运行时 package、保留现场逐字节一致（见下） |

机器核对摘要见 [closeout-check.json](closeout-check.json)。运行结论、截图与输入链接以 [README](README.md) 为入口。

## 归档完整性

- 10 份根级证据（两份报告、两份请求 JSONL、阶段、日志、资源快照前后、image、transcript）与保留现场哈希逐一相等，0 处不一致。
- 4 份 `tools/` 工具与运行时 `package/` 逐字节一致；`pattern.png` 沿用 run b 的 389 字节文件。
- 20 份归档文件（含 12 张截图与 4 份 `evidence/`）全部来自本轮，未覆盖或改动 run a/b 的任何文件。
- 本目录 `.gitattributes` 固定 `* -text`，保留原始运行字节；仅 Markdown 与 JSON 说明文件使用 LF。

## 边界与未覆盖项

- 本轮只证明本机 linux/amd64 候选镜像上的浏览器行为；不证明全站 XSS 安全、剪贴板粘贴专项、危险正文编辑保存、异地部署、独立 Linux、arm64、RC 与正式发布。
- 危险属性一项只验证渲染，数据库仍存原始危险正文，不能据此宣称存储层清洗。
- 既有丢失的图片属性不会因此自动恢复。
- 本规格为独立工作包，未绑定 Epic/Story，不修改 `sprint-status.yaml` 的完成数量或 Story 2.2 的 `review` 状态。

## 本次局部验证

- 归档文件哈希、归档与运行时工具一致性、请求日志字段白名单与事件计数、凭据扫描均为只读核对，未再次执行验收工具。
- 文档同步范围：本目录、[原规格](../../../_bmad-output/implementation-artifacts/spec-0-6-1-tiptap-browser-acceptance.md)、[TipTap 调查](../../TipTap残余风险调查-2026-09-19.md)、[R3 发布门禁](../../产品规划/开源发布范围与执行清单-2026-09-13.md#r3-remaining-gates)、[v0.6.1 说明](../../releases/v0.6.1.md)、[文档索引](../../README.md) 与 [CHANGELOG](../../../CHANGELOG.md)。
- 文档为 UTF-8、LF，链接与锚点静态检查通过；未执行四条完整门禁，也未重跑历史浏览器、恢复或升级矩阵。
