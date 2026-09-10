# GitHub 同类知识库项目调研（2026-09-08）

> 范围：与“知了”相近的个人知识库、笔记和 AI 知识管理项目。数据来自 GitHub README、GitHub REST API（仓库指标/Release）及公开定价页搜索结果。Stars、issues 等指标会动态变化，仅作规模和维护负担参考，不等同于满意度。

## 一、仓库指标快照

| 项目 | GitHub | Stars | Forks | Open issues | 最新 Release（抓取时） | 许可/定位 |
|---|---|---:|---:|---:|---|---|
| Logseq | [logseq/logseq](https://github.com/logseq/logseq) | 44,823 | 2,803 | 943 | 2.0.1（2026-07-13） | AGPL；隐私优先知识管理/协作 |
| Joplin | [laurent22/joplin](https://github.com/laurent22/joplin) | 56,275 | 6,273 | 641 | v3.7.16（2026-09-06） | 开源；离线优先 Markdown 笔记 |
| AppFlowy | [AppFlowy-IO/AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) | 76,443 | 5,985 | 1,026 | 0.14.1（2026-09-01） | AGPL；Notion 开源替代/AI workspace |
| AFFiNE | [toeverything/AFFiNE](https://github.com/toeverything/AFFiNE) | 72,326 | 5,244 | 731 | v0.27.4（2026-08-18） | 开源；Notion+Miro、文档/画布/AI |
| Outline | [outline/outline](https://github.com/outline/outline) | 40,491 | 3,543 | 74 | v1.10.0（2026-09-02） | BSL 1.1；团队知识库 |
| Anytype | [anyproto/anytype-ts](https://github.com/anyproto/anytype-ts) | 8,765 | 577 | 208 | v0.56.9-alpha（2026-09-07） | ASAL 1.0；P2P 加密知识 OS |
| SiYuan | [siyuan-note/siyuan](https://github.com/siyuan-note/siyuan) | 46,235 | 2,987 | 21 | v3.8.3（2026-09-07） | AGPLv3；中文块级知识管理 |
| TriliumNext | [TriliumNext/Trilium](https://github.com/TriliumNext/Trilium) | 37,765 | 2,535 | 677 | v0.105.0（2026-08-19） | AGPL；大型个人知识库 |
| Memos | [usememos/memos](https://github.com/usememos/memos) | 62,844 | 4,728 | 66 | v0.30.0（2026-07-26） | MIT；极简短文本时间线 |
| Khoj | [khoj-ai/khoj](https://github.com/khoj-ai/khoj) | 37,204 | 2,461 | 147 | 无 latest（持续发布倾向） | AGPL；AI second brain/agents |

## 二、项目证据与商业化

### Logseq

README 将其定义为隐私优先、开源知识管理与协作平台，支持 Markdown/Org-mode、任务、PDF 标注、插件、主题和移动端。DB 版本与 RTC 同步仍处 beta/alpha，README 明确提示可能丢数据并建议备份。收入信号是 [Open Collective 赞助](https://opencollective.com/logseq) 和逐步推出的 Sync/Pro 服务（[pricing](https://logseq.com/pricing)）。

可借鉴：本地优先、插件生态、赞助。风险：同步/迁移是高敏感痛点，应把备份和恢复做成可信资产。

### Joplin

[README](https://github.com/laurent22/joplin) 强调免费开源、offline-first、Markdown、全文搜索、插件/主题、Web Clipper、跨平台和 E2EE；可通过 Nextcloud、Dropbox、OneDrive 或 Joplin Cloud 同步。README 同时放置 PayPal、GitHub Sponsors、Patreon、IBAN 捐赠入口。官方 [Joplin Cloud plans](https://joplinapp.org/plans/) 另提供云同步和 self-hosted Business 路线。

可借鉴：免费客户端 + 付费托管同步/发布的双轨模式，以及加密和导入导出。

### AppFlowy

[README](https://github.com/AppFlowy-IO/AppFlowy) 定位为 Notion 开源替代和 AI workspace，Flutter+Rust，覆盖桌面/移动、数据库、看板、模板、AI、跨设备和自托管，AGPL。其使命强调数据隐私、原生体验、社区扩展；[AppFlowy-Cloud](https://github.com/AppFlowy-IO/AppFlowy-Cloud) README 的搜索摘要明确采用 open-core，提供 SaaS 与 self-hosted 方案；[pricing](https://appflowy.com/pricing) 为云端/团队计划入口。

可借鉴：开源客户端引流、云端和企业服务变现。知了不宜进入其全能 workspace 赛道。

### AFFiNE

[README](https://github.com/toeverything/AFFiNE) 定位 Notion+Miro 替代，local-first，文档/白板/表格融合，多模态 AI、实时协作、模板和自托管。官方 [pricing](https://affine.pro/pricing) 搜索结果显示 Free、Pro（约 $6.75/月）、Team（约 $10/席位）和 self-host Team License；自托管文档见 [self-host guide](https://docs.affine.pro/self-host-affine/)。

可借鉴：AI + 自托管 + 付费团队层组合。其功能面大、731 个 open issues，提示维护成本高。

### Outline

[README](https://github.com/outline/outline) 定位快速、协作、Markdown 兼容的团队知识库，官方托管版和 Docker 自托并存；README 明确 BSL 1.1，并要求贡献前先在 issue/discussion 对齐方案。官方托管定价见 [getoutline.com/pricing](https://www.getoutline.com/pricing)，大团队采用联系报价；自托受许可证约束。

可借鉴：托管云按团队规模收费、企业支持和高质量维护流程。知了是单用户产品，不应复制 RBAC/协作范围。

### Anytype

[README](https://github.com/anyproto/anytype-ts) 定位本地优先、P2P、端到端加密知识 OS：离线存储、可选同步、可组合 blocks/database/kanban/calendar、自定义 Types、gRPC/AI agents。许可为 Any Source Available License 1.0。官方 [pricing/membership](https://anytype.io/pricing/) 和 [memberships docs](https://doc.anytype.io/anytype/resources/memberships) 提供免费层、Builder/Business 会员；支持自托 AnySync（[docs](https://doc.anytype.io/anytype/data/sync-and-backup/self-host)）。

可借鉴：加密、数据主权和会员叙事。alpha 版本和复杂 P2P 带来稳定性风险，知了应保持 SQLite+Markdown 简化架构。

### SiYuan

[README](https://github.com/siyuan-note/siyuan) 定位隐私优先、自托管、块级引用和 Markdown WYSIWYG，提供 AI 写作/Q&A、OCR、PDF 注释、闪卡、移动端、Docker、API 和 Bazaar marketplace。README 明确“多数功能免费，商业使用也免费”，部分能力仅付费会员可用。官方 [pricing](https://b3log.org/siyuan/en/pricing.html) 说明同步服务容量成本和 8GB/用户限制；GitHub issue [#8906](https://github.com/siyuan-note/siyuan/issues/8906) 讨论一次性 PRO 费用。

可借鉴：中文市场、免费核心 + 会员/云同步 + 一次性 Lifetime + 社区市场，是最接近知了的商业验证。

### TriliumNext

[README](https://github.com/TriliumNext/Trilium) 聚焦大型个人知识库：无限层级树、克隆、富文本/代码/画布/思维导图、版本、属性查询/脚本、REST API、Web Clipper、加密、同步和移动前端，支持 10 万级笔记。收入主要是 [GitHub Sponsors](https://github.com/sponsors/eliandoran)、PayPal、Buy Me a Coffee；同步托管由第三方提供。

可借鉴：API、脚本和第三方托管生态。677 个 open issues 显示功能面扩大后的维护压力。

### Memos

[README](https://github.com/usememos/memos) 定位快速捕获、私密、自托管的短文本时间线；Markdown、附件、标签、搜索、置顶、选择性公开、Web Clipper、零 telemetry、MIT，一行 Docker 启动。官网 [pricing](https://usememos.com/pricing) 明确完全免费，无订阅/席位/用量/高级层；主要依靠 GitHub Sponsors 与赞助商。

可借鉴：capture-first、低运维、零 telemetry。高 stars 但无直接收费，说明需要额外的托管或 AI 服务收入。

### Khoj

[README](https://github.com/khoj-ai/khoj) 定位 AI second brain：接入本地/在线 LLM，检索 PDF/Markdown/Notion/Word/Org，支持 Web、Obsidian、Emacs、桌面、手机、WhatsApp，自定义 agents、自动化、newsletter、语义搜索、图像和语音；始终可自托，同时提供 cloud app。README 链接 [cloud app](https://app.khoj.dev) 和 [Enterprise](https://khoj.dev/teams)，支持 cloud/on-prem/hybrid，企业多为商务报价。

可借鉴：免费自托核心 + 云端 AI/自动化/企业部署收费；知了可用“严格来源约束、资料不足拒答、AI 不覆盖正文”形成可信差异化。

## 三、给知了的商业化结论

1. **优先托管服务**：免费自托核心不变，提供可选远程备份、同步、HTTPS/PWA 入口、升级托管；始终支持 Markdown/SQLite 导出。
2. **AI 托管网关按量/按月**：提供官方 OpenAI-compatible LLM/Embedding 代理和额度包；保留用户自带 Key 与本地模型，避免锁定。
3. **服务收入先行**：一次性部署、迁移、备份恢复和故障支持，记录重复工序后再产品化。
4. **会员/一次性 Pro 谨慎**：可收费的是便利性（托管、额度、自动备份、优先支持），不要锁核心数据格式和基础捕获/搜索。
5. **赞助与生态**：早期使用 GitHub Sponsors；待真实笔记超过冻结线后，再评估模板/集成市场。

## 四、差异化与验证实验

- 差异化：主题导向自动归档、严格来源问答和可回链引用、AI 不覆盖正文、Markdown/SQLite 双向可迁移、中文分词与混合检索、低门槛 Demo。
- 避免：白板/全能数据库/RBAC/多人协作等大功能，防止走向 AppFlowy/AFFiNE/Outline 的高维护赛道。
- 15-20 名中文自托用户访谈，验证是否愿意为“托管 AI/备份”付费。
- 价格烟雾测试：¥9/月 AI 额度、¥29/月 AI+备份、¥99 一次性安装迁移，仅收意向。
- 10 人封闭 Beta 指标：首条笔记完成率、AI 整理接受率、来源问答信任度、导出恢复成功率、7 日留存、每用户 AI 成本。
