# 文档索引

本目录收录项目的全部专项文档。根目录仅保留两份有位置约定的文件：[README.md](../README.md)（项目入口）与 [CONTEXT.md](../CONTEXT.md)（领域术语表，AI 协作工具按惯例从根目录读取）。

## 设计与部署

| 文档 | 内容 |
|---|---|
| [DESIGN.md](DESIGN.md) | 设计规范：Apple 画廊风 token 体系、组件语法、响应式规则；文末附录为暗色模式 token 对照表与裸色类使用规则 |
| [部署手册-tailscale.md](部署手册-tailscale.md) | 面向零部署经验读者的自托管全流程（Windows 主线，Linux/NAS 备注）：装 Docker → 下载代码 → 写配置 → 启动 → 配 AI → Tailscale 组网拿 HTTPS → 手机安装 PWA → 日常维护与按症状排查的 FAQ |
| [备份与恢复.md](备份与恢复.md) | 每日自动备份的内容与位置、异地备份建议、数据库/图片的完整恢复步骤（含 WAL 文件处理的关键坑） |
| [演示GIF录制清单.md](演示GIF录制清单.md) | 维护者材料：README 首屏演示 GIF 的录制环境、分镜与体积控制 |
| [开发日志.md](开发日志.md) | 维护者材料：各阶段的踩坑复盘、状态快照与下一步计划（跨会话接续开发用） |

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
