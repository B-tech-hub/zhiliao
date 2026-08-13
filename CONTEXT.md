# CONTEXT

本项目领域术语表。只收录术语与含义，不含实现细节。

## 术语

### 主题（Topic）
笔记的唯一归类维度，扁平一层。其中**未分类**是系统内置主题，不可删除、不可重命名。删除普通主题时，其下笔记回落到未分类。

### 未分类 / 收件箱（Inbox）
同一事物的两个称呼：AI 拿不准归属的笔记暂存地，也是主题建议的素材池。

### 删除（笔记）
物理删除，立即生效且**不可恢复**。没有回收站，也没有软删除。删除同时清除笔记的标签关联与搜索索引。

### 锁字段（Locked）
笔记的主题/标题/标签任一字段被用户手动修改过即"上锁"，AI 后续处理不再覆盖该字段。

### AI 状态（aiStatus）
笔记的 AI 处理进度：pending（待整理）→ processing（整理中）→ done / failed / skipped。失败可手动"重新处理"。

### AI 任务队列
数据库持久化的异步任务队列，由同进程的轮询 worker 消费，重启不丢任务。

### 主题建议
未分类笔记积攒后，AI 聚类产出的"新建/归入主题"建议，用户可逐条采纳或全部忽略。

### LLM 配置
调用 AI 服务所需的接入点（base URL）、API Key、模型名三元组。读取顺序：**设置页保存的值（数据库）优先，环境变量兜底**；超时时间仅由环境变量控制。相关决策见 [docs/adr/0001-llm-config-in-db.md](docs/adr/0001-llm-config-in-db.md)。

### 视觉模型（Vision）
AI 读图专用的第二组 LLM 配置（`vision_base_url` / `vision_api_key` / `vision_model`）。接入点与 Key 留空时回落文本模型配置；仅在显式配置了视觉模型名时"AI 看图"功能才可用。

### AI 对话（Chat）
围绕**当前笔记或主题**的问答会话：上下文（笔记全文 / 主题下笔记摘要列表）直接注入 prompt，不做全库检索。会话与消息持久化，回答走 SSE 流式。相关决策见 [docs/adr/0003-chat-context-injection.md](docs/adr/0003-chat-context-injection.md)。

### 富文本图片属性
笔记中调整过宽度/对齐/说明的图片，以内嵌 HTML `<img>` 形式存于 Markdown 正文，与纯 Markdown 图片 `![alt](url)` 混存。相关决策见 [docs/adr/0002-image-attrs-inline-html.md](docs/adr/0002-image-attrs-inline-html.md)。

### FTS 影子表
笔记的全文搜索索引副本。删除或修改笔记时必须同步更新，否则搜索会出现"幽灵结果"。
