# 安全政策

## 支持版本

| 版本 | 支持状态 |
| --- | --- |
| 最新 0.x 版本 | ✅ |
| 更早版本 | ❌ 请先升级到最新版复现 |

## 报告漏洞

请**不要**通过公开 Issue 报告安全漏洞。

请使用 GitHub 私密披露渠道：仓库页面 **Security → Report a vulnerability**（Private vulnerability reporting）。

- 7 天内确认收到并给出初步评估。
- 修复发布后，如你愿意，会在 Release Notes 中致谢。

## 威胁模型说明

知了是单用户自托管应用，设计假设是**不直接暴露公网**：

- 推荐经由 Tailscale 等内网方案访问（见 [docs/部署手册-tailscale.md](docs/部署手册-tailscale.md)）。
- 必须公网部署时，请置于反向代理 + HTTPS 之后，并设置强 `APP_PASSWORD` 与随机 `SESSION_SECRET`（≥32 字符）。
- LLM API Key 以明文存于本机 SQLite（settings 表），请像保护数据库文件一样保护它。
