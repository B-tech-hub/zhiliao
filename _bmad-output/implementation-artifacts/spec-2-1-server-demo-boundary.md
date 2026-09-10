---
title: 'Story 2-1 建立服务端 Demo 能力边界'
type: 'feature'
created: '2026-09-10'
status: 'done'
baseline_commit: '58efce6'
context:
  - 'D:/ClaudeProjects/ai_acknowladge/_bmad-output/implementation-artifacts/epic-2-context.md'
  - 'D:/ClaudeProjects/ai_acknowladge/_bmad-output/planning-artifacts/epics-github-install-distribution-demo.md'
  - 'D:/ClaudeProjects/ai_acknowladge/docs/Issue执行计划-2026-08-29.md'
  - 'D:/ClaudeProjects/ai_acknowladge/README.md'

## Intent

当前 `DEMO_MODE=1` 只负责播种演示数据和显示密码提示，登录后的访客仍可能修改模型配置、创建外部 Token、上传文件或触发备份/导入/重算。Story 2-1 将这些边界落实到服务端，并保留可复现的三步演示主流程。

## Boundaries & Constraints

**Always:** Demo 使用容器内 mock LLM；所有高风险限制在服务端执行；禁止路径返回明确 `403`；正式数据、正式卷和真实外部密钥不得进入 Demo。

**Never:** 不把 Demo 改造成多用户服务；不依赖前端隐藏作为唯一防护；不允许访客创建或吊销外部 API Token；不允许备份下载、数据导入、向量补算或外部模型配置写入。

## Tasks & Acceptance

- [ ] 盘点设置、Token、备份、导入、向量和高成本操作对应的 Route Handler/API，并定义 Demo 禁止清单。
- [ ] 在服务端统一识别 Demo 模式，禁止保存或清除外部模型配置，强制使用 mock LLM。
- [ ] 为禁止的 Route Handler/API 增加 403 响应，并为前端入口增加辅助隐藏或禁用状态。
- [ ] 保留新建普通文本笔记、AI 自动归档和主题建议主路径。
- [ ] 增加 Demo 模式测试，覆盖允许路径、禁止路径和未登录路径。

验收标准：

- 直接请求每个禁止 API 时返回 403，不能只依赖前端隐藏。
- Demo 中无法保存或使用外部模型配置，且运行路径使用 mock LLM。
- 访客无法创建或吊销外部 API Token，也无法获取写入或读取正式知识库的 Token。
- 新建普通文本笔记、AI 自动归档和主题建议流程保持可用。

## Verification

- 运行 Story 2-1 对应的服务端单元/集成测试。
- 使用直接 HTTP 请求验证禁止路径均为 403，并验证允许路径仍返回预期状态。
- 检查测试配置、正式配置和 Demo 配置的数据库、卷、环境文件与密钥路径隔离。

## Suggested Review Order

**服务端统一边界**

- 统一 Demo 判定与错误响应
  [`demo-guard.ts:3`](../../src/lib/demo-guard.ts#L3)
- 高风险入口先行拒绝
  [`llm-route.ts:30`](../../src/app/api/settings/llm/route.ts#L30)
- Token 管理不暴露正式凭据
  [`tokens-route.ts:9`](../../src/app/api/settings/tokens/route.ts#L9)
- 数据出口与文件写入受限
  [`export-route.ts:12`](../../src/app/api/export/route.ts#L12)
- 模型配置固定 mock
  [`llm-config.ts:124`](../../src/lib/llm-config.ts#L124)
- 直接路由测试覆盖边界
  [`demo-boundary.test.ts:18`](../../tests/api/demo-boundary.test.ts#L18)
