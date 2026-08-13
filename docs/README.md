# 文档索引

本目录收录项目的全部专项文档。根目录仅保留两份有位置约定的文件：[README.md](../README.md)（项目入口）与 [CONTEXT.md](../CONTEXT.md)（领域术语表，AI 协作工具按惯例从根目录读取）。

## 设计与部署

| 文档 | 内容 |
|---|---|
| [DESIGN.md](DESIGN.md) | 设计规范：Apple 画廊风 token 体系、组件语法、响应式规则；文末附录为暗色模式 token 对照表与裸色类使用规则 |
| [部署手册-tailscale.md](部署手册-tailscale.md) | 面向零部署经验读者的自托管全流程（Windows 主线，Linux/NAS 备注）：装 Docker → 下载代码 → 写配置 → 启动 → 配 AI → Tailscale 组网拿 HTTPS → 手机安装 PWA → 日常维护与按症状排查的 FAQ |

## 架构决策记录（ADR）

记录"为什么这么做"的非显然取舍，按编号递增：

| 编号 | 决策 |
|---|---|
| [0001](adr/0001-llm-config-in-db.md) | LLM 配置存数据库，环境变量兜底 |
| [0002](adr/0002-image-attrs-inline-html.md) | 图片宽度/对齐属性以内嵌 HTML 序列化进 Markdown |
| [0003](adr/0003-chat-context-injection.md) | AI 对话的笔记/主题上下文注入方式 |
| [0004](adr/0004-table-gfm-markdown.md) | 表格以 GFM Markdown 存储，不支持合并单元格与列宽 |
| [0005](adr/0005-dark-mode-class-next-themes.md) | 暗色模式：next-themes class 策略 + `.dark {}` 直接覆盖 token |
| [0006](adr/0006-pwa-offline-shell.md) | PWA 采用"纯离线壳"Service Worker，不做业务缓存 |
