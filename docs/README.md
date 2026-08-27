# 文档索引

本目录收录项目的全部专项文档。根目录仅保留两份有位置约定的文件：[README.md](../README.md)（项目入口）与 [CONTEXT.md](../CONTEXT.md)（领域术语表，AI 协作工具按惯例从根目录读取）。

## 设计与部署

| 文档 | 内容 |
|---|---|
| [DESIGN.md](DESIGN.md) | 设计规范：Apple 画廊风 token 体系、组件语法、响应式规则；文末附录为本项目字体、字阶、圆角、暗色 token 与 CI 设计门禁 |
| [部署手册-tailscale.md](部署手册-tailscale.md) | 面向零部署经验读者的自托管全流程（Windows 主线，Linux/NAS 备注）：装 Docker → 下载代码 → 写配置 → 启动 → 配 AI → Tailscale 组网拿 HTTPS → 手机安装 PWA → 日常维护与按症状排查的 FAQ |
| [备份与恢复.md](备份与恢复.md) | 每日自动备份的内容与位置、异地备份建议、数据库/图片的完整恢复步骤（含 WAL 文件处理的关键坑） |
| [演示GIF录制清单.md](演示GIF录制清单.md) | 维护者材料：README 首屏演示 GIF 的录制环境、分镜与体积控制 |
| [开发日志.md](开发日志.md) | 维护者材料：各阶段的踩坑复盘、状态快照与下一步计划（跨会话接续开发用） |
| [取用能力收尾计划.md](取用能力收尾计划.md) | 「从记得下到找得回」这条线剩余任务的排期、依赖与验收标准：真实供应商实测、长笔记分块、AI 查询改写、出口三件套余项 |
| [图片与深度思考测试指南.md](图片与深度思考测试指南.md) | 20 MB 图片与 HEIC、宽屏目录、普通/看图/深度思考组合的手工验收和自动检查步骤 |
| [手写摄取与公式验收.md](手写摄取与公式验收.md) | 手写图片转写、原图核对、数学公式保真与队列失败重试 |

## 架构决策记录（ADR）

记录"为什么这么做"的非显然取舍，按编号递增：

| 编号 | 决策 |
|---|---|
| [0001](adr/0001-llm-config-in-db.md) | LLM 配置存数据库，环境变量兜底 |
| [0002](adr/0002-image-attrs-inline-html.md) | 图片宽度/对齐属性以内嵌 HTML 序列化进 Markdown |
| [0003](adr/0003-chat-context-injection.md) | AI 对话的笔记/主题上下文注入方式（作用域前提已被 0008 取代） |
| [0004](adr/0004-table-gfm-markdown.md) | 表格以 GFM Markdown 存储，不支持合并单元格与列宽 |
| [0005](adr/0005-dark-mode-class-next-themes.md) | 暗色模式：next-themes class 策略 + `.dark {}` 直接覆盖 token |
| [0006](adr/0006-pwa-offline-shell.md) | PWA 采用"纯离线壳"Service Worker，不做业务缓存 |
| [0007](adr/0007-soft-delete-trash.md) | 回收站采用软删除（30 天），清扫挂备份之后、孤儿以正文引用判定；不做版本历史 |
| [0008](adr/0008-assistant-tool-calling.md) | AI 助手采用工具调用；禁止正文覆盖；仅删除需确认，其余靠操作卡片与撤销兜底 |
| [0009](adr/0009-fetch-url-safety.md) | `fetch_url` 以「只抓用户提过的网址」为第一层防护，防的是外泄而非仅 SSRF |
| [0010](adr/0010-grounded-source-chat.md) | 来源问答：会话级严格接地，检索限定在来源集内，模型不得用自身知识补充 |
| [0011](adr/0011-image-generation.md) | 图像生成只做 OpenAI 兼容同步接口；不设确认卡片，改用每条消息 2 张封顶；接地会话禁用 |
| [0012](adr/0012-weekly-review.md) | 每周回顾产物为普通笔记入固定主题；调度用「每小时对表」而非日历定时器 |
| [0013](adr/0013-vision-image-payload.md) | 视觉请求使用内存压缩副本与字节预算；识别结果由用户显式存为笔记 |
| [0014](adr/0014-heic-original.md) | HEIC 保留原件并另存 JPEG 展示副本，导出/备份/清扫四条链路成对处理 |
| [0015](adr/0015-deep-thinking-tools-and-trace.md) | 深度思考照常下发全部工具（能力单独探测）；思考过程落库展示但绝不回灌上下文 |
| [0016](adr/0016-shared-prose-layer.md) | 手写共享正文排版层 `.prose-note`，编辑器与助手回答共用；不装 typography 插件 |
| [0017](adr/0017-handwriting-transcription-and-math.md) | 手写转写与公式识别：摄取管道、复核状态与告警 |
| [0018](adr/0018-hybrid-search.md) | BM25 + Embedding 的混合检索、BLOB 存储、RRF 融合与模型漂移降级 |
| [0019](adr/0019-external-access.md) | 外部接入 Token 权限、快速捕获与只读 MCP 边界 |
| [0020](adr/0020-incremental-markdown-export.md) | 笔记持续增量导出 Markdown 与路径清理策略 |
| [0021](adr/0021-correction-learning.md) | 用户纠正样例、Prompt 注入与关闭/清理策略 |
| [0022](adr/0022-writing-related-notes.md) | 写作侧相关笔记召回与候选约束的冲突提示 |
| [0023](adr/0023-note-chunking.md) | 长笔记分块存储、标题注入与 max-pooling 检索 |
| [0024](adr/0024-markdown-zip-import.md) | Markdown zip 反向导入：判重、AI 整理开关与不可信输入的边界 |
