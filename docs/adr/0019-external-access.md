# ADR 0019：外部接入 Token 与 MCP

## 状态

已采用（2026-08-24）。

## 决策

- Token 只在设置页主动创建，服务默认不生成 Token。
- 数据库只保存 SHA-256 哈希、前缀、末四位、权限和生命周期字段；明文只在创建响应中返回一次。
- 首期权限固定为 `capture:write` 与 `knowledge:read`。
- `capture:write` 只能调用 `POST /api/external/capture` 创建笔记。
- `knowledge:read` 可调用 `GET /api/external/knowledge`，并可通过 `/api/mcp` 使用只读语义工具。
- MCP 首期提供 `search_knowledge` 与 `get_knowledge`，不暴露删除、配置、向量补算等高风险操作。
- 浏览器 Session 认证保持不变，外部请求使用 `Authorization: Bearer <token>`。

## 后果

单用户部署不需要注册或用户表，同时可以安全接入快捷指令、脚本和 AI 客户端。Token 吊销立即生效；丢失明文时必须重新创建。
