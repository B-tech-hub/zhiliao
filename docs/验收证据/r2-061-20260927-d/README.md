# R2 运行记录：061-20260927-d

**结论：构建和完整数据恢复矩阵通过，R2 总体验收未通过，浏览器脚本在补充请求处停止。** 本轮没有重试或修改产品代码。三个实例已停止，九卷及源包保留。机器结果见 [summary.json](summary.json)。

## 输入与构建

- 执行提交：`fa815759ab3c49bbff0e889c8299def70e670c49`。
- 候选清单：`0a2819f376993fafa61b27f57a9a978ff7ef1c7635d88e8485bee7c0655c7baf`，276 文件。实际构建上下文逐文件核对通过。
- 本地标签：`zhiliao-r2:0.6.1-0a2819f37699`。
- 实际 image ID：`sha256:f262652592dd2bd32d00aae44f60d4c98caa2c89ca0942254f77918f57aacb4a`，linux/amd64、默认用户 node。这是本地镜像身份，不是发布 digest。
- 构建一次：北京时间 19:48:22 至 19:49:28。npm ci 命中 run c 的依赖缓存，Next.js 构建和内置 lint/类型检查实际运行成功；不记作新一次依赖下载安装或完整四条发布门禁。
- [构建日志](build.log.txt)保留 libheif 静态依赖、package.json 命名导入和 jose Edge Runtime 警告，未自动修复。没有重新执行 npm 审计，不产生新的漏洞计数。

本目录 [candidate-identity.json](candidate-identity.json) 原样复制准备阶段文件，其中 `prepared-not-built` 是准备时状态；本轮实际状态以 [image.json](image.json) 和运行记录为准。

## 实际结果

| 检查 | 结果与证据 |
|---|---|
| PNG、真实 HEIC 上传转换 | 通过，建立四条合成笔记和两组图片；[源样本记录](source/seed.json) |
| 增量 Markdown | 新建、修改正文、改名/移动、回收站恢复与清理通过；[执行日志](transcript.txt)、source-markdown 原文件 |
| ZIP 导出与两次导入 | 首次 3 条有效笔记、2 组图片；第二次新增/覆盖/图片均 0、跳过 3、失败 0，无整理任务；[报告](import/import-reports.json) |
| ZIP 字段及图片字节 | exportedNotes 和 pairedImages 完全相同；图片 URL 规范化为内容哈希后比较 |
| 完整快照恢复 | SQLite 完整性、图片配对、业务表、正文及元数据通过；源库与恢复启动前/后两份状态全部相同 |
| 恢复后真实 HTTP 读取 | 通过，包含上次失败的 UUID JPEG；PNG/JPEG 与磁盘字节相同，会话、来源、搜索及正文可读；[readback](restore/readback.json) |
| 重启持久化 | 新写标记的正文与增量 Markdown 在重启后保留，见 transcript 和 [persist](restore/persist.json) |
| 浏览器登录与短笔记 | 通过；[首页](browser/01-home.png)、[短文](browser/02-short.png) |
| 浏览器长文、表格、PNG | 页面加载成功，表格值 42、图片可见且 naturalWidth/naturalHeight 为 96×64 的断言通过；额外 API 字节请求返回 401，当前用例最终失败，见[现场截图](browser/failure.png) |
| 浏览器 HEIC、搜索跳转、历史与来源 | 未执行，失败后没有继续 |
| 源快照、正式实例保护 | 源文件集合和哈希保持；正式容器 ID、启动时间、重启次数、挂载及所记录卷列表前后相同 |

数据阶段于北京时间 19:50:02 至 19:50:21 完成，浏览器于 19:51:23 至 19:51:26 执行；19:51:28 停止恢复实例并完成正式资源核对。[stages.jsonl](stages.jsonl)记录操作单各块结果，浏览器结果单独见 [browser.json](browser.json)，不能只看命令块全部 passed 就判断整轮通过。

## 浏览器停止原因

这是验收脚本的两种请求方式不一致：页面中的 PNG 已加载，随后 [browser-check.cjs](browser-check.cjs) 用 `page.request.get()` 再做字节核对，返回 401。

生产登录 Cookie 设置 `Secure`。当前 Playwright `1.64.0-alpha-1789764292000` 的 API 请求 Cookie 过滤逻辑仅给 `localhost`/`.localhost` 提供 HTTP 例外，不包括 `127.0.0.1`，因此会过滤该地址上的 Secure Cookie。浏览器页面与 Playwright APIRequestContext 行为不同。实际 Cookie 请求头没有留存；归因依据是运行现象和[静态源码摘录及哈希](browser-diagnosis.json)，不是额外重放请求所得。

没有修改登录接口、Cookie 安全属性或 HEIC 修复，也没有启动第二次构建。后续建议只修正浏览器工具的请求方式，用页面同源 `fetch` 继承实际浏览器登录态，再按[浏览器补验计划](../../../_bmad-output/implementation-artifacts/spec-r2-browser-followup.md)另行确认；复用此镜像和已恢复的专用目标，不重复已经通过的数据矩阵。

## 现场与归档

- [runtime-containers.json](runtime-containers.json)：三容器均停止、同一 image ID、node 用户。source/import 为 network none，restore 保留浏览器阶段的 bridge 配置与 127.0.0.1:3313 绑定，但停止状态无活动服务。
- [retained-volumes.json](retained-volumes.json)：九卷保留；未 down -v、prune 或删除源包。原目录 `%TEMP%/zhiliao-r2-061-20260927-d` 保留临时凭据，不提交 env。
- [archive-manifest.json](archive-manifest.json)：58 份原始文件逐字节归档，包括 ZIP、快照、图片、Markdown、日志、执行脚本和三张截图；扫描三组临时密码与密钥共六个值，UTF-8/UTF-16LE 无匹配。
- [归档核对](archive-check.json)：原文件、构建上下文、源快照、旧候选字节及旧 run c 保护均核对。日志空格和 transcript 换行不清理。
- 额外旧现场核对有两处工具噪音，见 [protection-check.json](protection-check.json)：首次 ID 收集错误形成无效的只读 inspect 参数；之后的原文比对遇到 Mounts 数组顺序变化。保留原始输出，按 Destination 排序后完整身份与挂载相同，不把顺序变化记作资源被改动。

本轮只覆盖本机、小规模、同版本数据恢复。尚不代表 R2 完成、0.6.0 升级回退、异地恢复、独立 Linux、arm64、无缓存分发、RC 或正式发布通过。原 a/b/c 失败不覆盖。
