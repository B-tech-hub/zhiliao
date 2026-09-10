# 文档索引

本目录收录项目的全部专项文档。根目录保留三份有位置约定的文件：[README.md](../README.md)（项目入口）、[CONTEXT.md](../CONTEXT.md)（领域术语表）与 [AGENTS.md](../AGENTS.md)（Agent 项目级约束入口）。

## 产品规划

| 文档 | 内容 |
|---|---|
| [产品规划交付包](产品规划/README.md) | 本轮规划结论、阅读顺序、交付边界和与现有 Roadmap/ADR 的关系 |
| [同类产品调研](产品规划/同类产品调研-2026-08-30.md) | 28 轮检索记录、开源竞品对比、官方来源与取舍依据 |
| [知了产品视觉 PRD](产品规划/知了产品视觉PRD-v1.0.md) | 产品定位、App 形态、用户流程、页面规格、视觉基线、指标和路线图 |
| [知了开发实施方案](产品规划/知了开发实施方案-v1.0.md) | 当前架构、部署、数据、外部 API、实施批次、安全、测试、发布与文档同步 |
| [知了规划审计记录](产品规划/知了规划审计记录-v1.0.md) | 代码库审计、两轮独立规划审计、问题修正和最终结论 |
| [知了商业化行动规划](产品规划/知了商业化行动规划-v1.0.md) | v1.1：服务先行、赞助并行、托管候补、功能冻结，以及真实付款、交付、成本和停止门槛 |
| [首轮付费验证 SPEC 与执行材料](../_bmad-output/specs/spec-zhiliao-commercialization-pressure-test/SPEC.md) | 七项能力、服务说明、访谈、订单、验收、人工台账及 90 天执行安排；未定条款在接单前填写 |
| [首轮详细执行手册](../_bmad-output/specs/spec-zhiliao-commercialization-pressure-test/pilot-runbook.md) | 首周 15 小时日程、候选查找、邀请与访谈话术、条款建议、¥299 报价样例、交付和复盘 |

## 开发与设计

| 文档 | 内容 |
|---|---|
| [开发规范](开发规范.md) | 需求门禁、架构边界、编码、API、数据、AI、安全、验证、文档同步和完成定义 |
| [UI 规范](UI规范.md) | App 唯一 UI 执行规范：布局、token、组件、状态、响应式、键盘、焦点、无障碍和验收 |
| [DESIGN.md](DESIGN.md) | Apple 视觉研究与历史实装记录，仅作参考，不再作为知了 App 页面模板 |

## 部署与专项验收

| 文档 | 内容 |
|---|---|
| [首次使用与故障排查](首次使用与故障排查.md) | 面向首次使用者的登录、首条笔记、AI 整理、主题与搜索闭环，以及按症状排错、实例隔离和安全边界 |
| [部署手册-tailscale.md](部署手册-tailscale.md) | 面向零部署经验读者的自托管全流程（Windows 主线，Linux/NAS 备注）：装 Docker → 下载代码 → 写配置 → 启动 → 配 AI → Tailscale 组网拿 HTTPS → 手机安装 PWA → 日常维护与按症状排查的 FAQ |
| [手机快捷记录.md](手机快捷记录.md) | iOS 快捷指令首版：创建专用 Token、应用内自测、分享文本/网址、语音听写、错误处理与吊销 |
| [手机快捷记录产品说明](../public/mobile-capture-guide.html) | 面向普通用户的 HTML 产品说明，可直接打开或从设置页进入 |
| [备份与恢复.md](备份与恢复.md) | 每日自动备份的内容与位置、异地备份建议、数据库/图片的完整恢复步骤（含 WAL 文件处理的关键坑） |
| [演示GIF录制清单.md](演示GIF录制清单.md) | 维护者材料：README 首屏演示 GIF 的录制环境、分镜与体积控制 |
| [开发日志.md](开发日志.md) | 维护者材料：各阶段的踩坑复盘、状态快照与下一步计划（跨会话接续开发用） |
| [取用能力收尾计划.md](取用能力收尾计划.md) | 「从记得下到找得回」这条线剩余任务的排期、依赖与验收标准：真实供应商实测、长笔记分块、AI 查询改写、出口三件套余项 |
| [图片与深度思考测试指南.md](图片与深度思考测试指南.md) | 20 MB 图片与 HEIC、宽屏目录、普通/看图/深度思考组合的手工验收和自动检查步骤 |
| [手写摄取与公式验收.md](手写摄取与公式验收.md) | 手写图片转写、原图核对、数学公式保真与队列失败重试 |
| [130 篇测试笔记隔离验收](测试笔记隔离验收-2026-09-08.md) | 导入与去重、13 个固定问题、候选截断与长文续读的修复前后证据，以及剩余的自然问句排名问题 |
| [Issue执行计划-2026-08-29.md](Issue执行计划-2026-08-29.md) | 当前开放 Issue 的优先级、依赖、分批执行方案、验证门禁、文档同步与失败条件 |
| [v0.6.0 Release Notes](releases/v0.6.0.md) | v0.6.0 对外版本说明、升级提醒与 Docker 镜像用法 |

## Agent 协作

| 文档 | 内容 |
|---|---|
| [问题跟踪](agents/issue-tracker.md) | GitHub Issues 的位置与 `gh` CLI 操作约定 |
| [分诊标签](agents/triage-labels.md) | 工程 skill 使用的五类分诊状态与 GitHub 标签映射 |
| [领域文档规则](agents/domain.md) | `CONTEXT.md` 与 ADR 的读取、术语和冲突处理规则 |

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
| [0025](adr/0025-non-core-features-off-by-default.md) | 四项非核心功能默认关闭：开关语义、降级表现与服务端拦截 |
## 批次规划

| 文档 | 内容 |
|---|---|
| [执行批次计划-2026-09-09.md](执行批次计划-2026-09-09.md) | GitHub 安装与首次使用、Demo 安全化、可复现演示和 ADR 分发的 Epic/Story 批次与退出条件 |
