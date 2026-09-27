# R2 运行记录：061-20260927-c

**结论：候选构建成功，R2 未通过。** 2026-09-27 获用户确认后执行一次构建及既定 R2，恢复后的 HEIC 展示图请求返回 HTTP 400，按操作单停止，没有重试。机器结果见 [summary.json](summary.json)。

## 输入与构建

- 执行提交：`6577710f2b42dc342316122cc951918e27b1cefa`。
- 候选清单：`225d7f540276242ed323269bdfc331c679b5e301843949a2f9928954a27168b3`，272 文件，构建前全量字节匹配。
- 本地标签：`zhiliao-r2:0.6.1-225d7f540276`。
- 实际 image ID：`sha256:90683fa43f261bcde5cbecd9ecfd7938784b8da989df67f3bd7c7dc8a063d2d9`，`linux/amd64`、默认用户 `node`。这是本地身份，不是已发布 GHCR digest。
- 构建时间：19:20:58 至 19:23:26（UTC+8）。`npm ci` 实际执行 79.7 秒，安装 762 个包；Next.js 生产构建及内置类型检查完成。基础镜像/WORKDIR 有缓存，不记作全新无缓存安装。
- 原始 [build.log.txt](build.log.txt) 与 [image.json](image.json) 留存；安装自带审计为 32 moderate，保留 libheif 静态依赖、package.json 命名导入及 jose Edge Runtime 编译警告，没有自动修复或升级依赖。

## 已执行与未执行

| 检查 | 结果 |
|---|---|
| 上传 PNG、真实 HEIC 并转 JPEG | 通过；四条合成笔记、两组图片 |
| 增量 Markdown | 新建、改正文、改名/移动、回收站恢复和清理通过 |
| ZIP 导出、两次导入 | 第一次导入 3 条有效笔记及 2 组图片；第二次新增/覆盖/图片均为 0、跳过 3，失败 0，无整理任务 |
| ZIP 逐字段及图片字节 | `exportedNotes`、`pairedImages` 比对通过，图片 URL 按字节哈希规范化 |
| 配对快照与恢复启动前 | SQLite 完整性通过；源库与恢复启动前业务表、图片、元数据完全相同。启动前比对在失败后只读补做，未重跑运行步骤 |
| 恢复启动后的 HTTP 读取 | **失败**：HEIC 的 JPEG 返回 400；完整 readback 报告未生成 |
| 恢复启动后状态比对、重启持久化 | 未执行 |
| 浏览器 | 未执行，未发布 3313 端口 |
| 源快照保护 | 失败后只读重算，前后文件集合和 SHA-256 一致 |
| 正式实例保护 | 运行前后容器 ID、启动时间、重启次数及所记录卷列表相同 |

执行顺序与时点见 [stages.jsonl](stages.jsonl)；归档时扫描三套临时密码和密钥，原始 transcript 无匹配；不归档任何 env 文件。失败前的完整脚本入口保存在 [run-stage.ps1](run-stage.ps1) 和 [operation-sheet.md](operation-sheet.md)，仅用于回溯，**不可在这个 run 重放**。

## 失败定位

实际请求为 `GET /api/images/e03aab43-df51-41a6-a409-ba143c5984e7.jpg`，HTTP 400。

[上传接口](../../../src/app/api/uploads/route.ts#L33) 为 HEIC 的展示图使用 `crypto.randomUUID()`；[读取接口](../../../src/app/api/images/[filename]/route.ts#L11) 的 `^[a-z0-9]+\.(png|jpg|gif|webp)$` 不接受连字符，因此在查库和读文件之前返回“非法文件名”。PNG 使用普通 id，符合该规则。HEIC 原件不属于展示路由允许格式，本次失败针对 JPEG，不要求浏览器直读原件。

[只读定位结果](image-failure-probe.json)确认 JPEG 和 HEIC 原件均在快照中，字节与数据库记录相符；恢复启动前状态与源库完全一致。来源会话和搜索检查在脚本中先于图片失败点，但未留独立成功响应，因此不把本次完整 readback 记为通过。

这是既有上传与读取规则不一致；本轮仅更换依赖下载源，业务文件字节未改。建议下一步按[修复计划](../../../_bmad-output/implementation-artifacts/spec-r2-heic-image-read.md)兼容已有 UUID 展示文件名，保留路径和扩展名边界，补路由回归后生成新候选再申请复验。本轮未修改产品代码。

## 现场保留与验收边界

[runtime-containers.json](runtime-containers.json)记录三个容器均已停止，网络为 `none`，实际镜像与候选相同；[retained-volumes.json](retained-volumes.json)列出九个保留卷。原临时目录为 `%TEMP%/zhiliao-r2-061-20260927-c`，包含凭据和原现场，未删除；未执行 down -v 或 prune。不要用旧身份、旧 env 或旧源包覆盖新的运行目录。

[archive-manifest.json](archive-manifest.json)记录 46 份原始文件的来源名、大小和 SHA-256，包括源 ZIP、数据库/完整图片配对快照、四类状态与日志。源数据库只含合成数据。归档的日志保留原字节及行尾空格。

本机、小规模、同版本结果不替代异地恢复、0.6.0 升级回退、arm64、无缓存分发、RC 或完整发布门禁。R2、Story 2.2 和正式发布状态均未关闭。
