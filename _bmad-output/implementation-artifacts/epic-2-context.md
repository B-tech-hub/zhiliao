# Epic 2 Context: 公网 Demo 安全化

## Goal

在公开访问前，把现有 Demo 从“播种数据和提示密码”的本地演示，收敛为服务端强制限制的演示环境，确保 Demo 不会访问正式数据、保存外部模型配置或暴露高风险操作。

## Stories

- Story 2.1：建立服务端 Demo 能力边界
- Story 2.2：隔离 Demo 部署并限制资源
- Story 2.3：建立重置、健康检查与故障恢复手册

## Requirements & Constraints

- Demo 永远使用容器内 mock LLM；服务端拒绝保存或清除外部模型配置。
- Demo 禁止创建或吊销外部 API Token、备份下载、数据导入、向量补算和高成本设置操作。
- 被禁止的 Route Handler/API 必须直接返回 403；前端隐藏只能作为辅助措施。
- 保留新建普通文本笔记、AI 自动归档和主题建议主流程。
- Demo 不得访问正式数据目录、正式卷、正式环境文件或真实外部模型密钥。

## Cross-Story Dependencies

2026-09-13 已批准[开源发布优先范围调整](../planning-artifacts/sprint-change-proposal-2026-09-12-open-source-first.md)：开源交付与免费自托管反馈先行，Epic 2 剩余公网工作后移。本机成果保留，Story 2.2 的原验收、基线和冻结块不改；本次不改变 Story/Sprint 状态。

- Story 2.1 依赖 Story 1.1 固化的 v0.6.0 运行边界，当前已完成。
- Story 2.2 依赖 Story 2.1 的服务端能力边界，并另需维护者确认服务器、域名、DNS、HTTPS、费用和是否共机。
- Story 2.3 依赖 Story 2.2 全部原验收与审查通过，本机结果不解除依赖。
- Story 3.1 改依赖 1.2/1.3 与固定版本，在隔离本地实例复现；公网重置联验仍归 Epic 2 上线验收，由 Story 3.3 留存关联证据。
