# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与[语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 修复

- 设置页「AI 服务」两组配置形态不一致：视觉模型的字段顺序原为「模型 → 接入点 → API Key」，现与文本模型统一为「接入点 → 模型 → API Key」；并补齐每个字段的来源徽标（新增「回落文本模型」一态，与「未配置」区分）与「测试连接」按钮
- 体验模式下 AI 对话没有任何回复：内置 mock LLM 不处理 `stream: true`，始终返回非流式 JSON，导致 SSE 解析读不到内容（表现为消息发出后 AI 毫无反应，且不报错）

### 变更

- mock LLM 支持流式响应，并新增 AI 对话与读图的模拟回复；原先对话请求会落到兜底分支，只回一句 `{"pong":true}`

## [0.2.0] - 2026-08-14

### 新增

- 回收站：删除笔记改为移入回收站，30 天内可恢复（恢复时搜索索引重建、被打断的 AI 整理自动续跑）；到期随每日清扫彻底删除。入口在 设置 → 数据
- 导出全部数据：设置页一键下载 zip——`主题名/标题-id.md` 目录结构，frontmatter 携带主题/标签/时间等元数据，图片集中在 `assets/` 且正文引用已改写为相对路径，可直接导入 Obsidian 等工具
- 设置页「立即备份」按钮与最近备份时间展示（复用每日备份逻辑，连点自动合并）

### 变更

- 删除语义：物理删除 → 移入回收站；「彻底删除」仅在回收站内可执行
- 孤儿数据随每日清扫回收：无笔记引用的图片（含历史遗留）、失去归属对象的 AI 会话；清扫只在当天备份成功后执行（先备份后销毁）
- 彻底删除的数据在既有备份中最多再保留 7 天（备份轮转所致），此后不可找回

## [0.1.1] - 2026-08-13

### 新增

- 一键体验模式：`npm run demo`（或 `docker compose -f docker-compose.demo.yml up -d`），内置演示数据与本地 mock LLM，无需 API Key 即可体验「随手记 → AI 自动归档 → 主题建议」完整流程
- 健康检查端点 `/api/healthz`；Docker 镜像内置 `HEALTHCHECK`，`docker ps` 可直接看到 healthy 状态
- 每日备份纳入图片目录 `uploads/`（与数据库快照一样保留最近 7 份）；新增文档《[备份与恢复](docs/备份与恢复.md)》
- Vitest 单元测试基线（搜索分词/FTS、标签、AI 流水线、LLM 容错、会话），CI 加入测试步骤
- 发布工作流：推送版本 tag 自动构建多架构（amd64/arm64）镜像发布至 `ghcr.io/b-tech-hub/zhiliao`，并自动创建 GitHub Release
- 社区文件：CONTRIBUTING、SECURITY、Issue/PR 模板
- 英文快速上手 `README.en.md`

### 变更

- `docker-compose.yml` 默认使用预构建镜像（保留本地构建回退方式）
- README 重构：一键体验入口、预构建镜像部署为主路径

## [0.1.0] - 2026-08-13

### 新增

- 首个公开版本：随手记 Markdown 笔记，AI 自动生成标题/标签/摘要并归档到主题
- 低置信度笔记进入「未分类」收集箱，累积后 AI 聚类建议新主题
- 中文全文搜索（jieba 分词 + SQLite FTS5）
- 围绕笔记/主题的 AI 对话（SSE 流式，可选视觉模型读图）
- PWA、深浅色主题、图片上传
- 单密码登录 + JWT 会话；Docker 部署；每日自动备份数据库

[未发布]: https://github.com/B-tech-hub/zhiliao/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/B-tech-hub/zhiliao/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/B-tech-hub/zhiliao/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/B-tech-hub/zhiliao/releases/tag/v0.1.0
