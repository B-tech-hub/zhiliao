# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与[语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

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

[未发布]: https://github.com/B-tech-hub/zhiliao/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/B-tech-hub/zhiliao/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/B-tech-hub/zhiliao/releases/tag/v0.1.0
