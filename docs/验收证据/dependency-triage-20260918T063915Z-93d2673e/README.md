# 依赖分诊取证

日期：2026-09-18。对应[分诊报告](../../依赖告警分诊-2026-09-18.md)。本目录记录只读查询和内存探针，不是依赖修复或发布验收结果。

| 文件 | 含义 |
|---|---|
| `summary.json` | 工具版本、时间、文件指纹、命令、统计及执行边界 |
| `npm-audit-all.json`、`npm-audit-production.json` | 同一锁文件的全量与排除开发依赖查询；均因告警退出 1 |
| `dependency-inventory.json` | 相关包的锁定/本机版本、开发/可选标志及父依赖声明 |
| `candidate-comparison.json` | 10 个文件与两次历史候选清单的 SHA-256 对照 |
| `advisories/` | GitHub 官方 Advisory API 的六份原始 JSON；上游机器字段和公告语言保留 |
| `registry/` | npm 官方 registry 的五份精确目标版本元数据；未安装这些版本 |
| `tiptap-boundary-probe.json` | 无执行能力的属性标记探针：helper 缺陷与标准图片 schema 对照 |
| `harness/tiptap-boundary-probe.mjs.txt` | 探针源码，运行时从指定工作区加载已安装包；输出路径由参数指定 |
| `artifact-manifest.json` | 本目录证据文件的 SHA-256；不包含它自身 |
| `verification.json` | 文档、证据统计与本轮工作区保留核对 |

审计命令在仓库根目录运行，未安装依赖：

```powershell
npm.cmd audit --json --package-lock-only --include=dev --include=optional --include=peer --ignore-scripts --registry=https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=20000
npm.cmd audit --json --package-lock-only --omit=dev --include=optional --include=peer --ignore-scripts --registry=https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=20000
```

两次查询使用 Node.js 22.19.0、npm 10.9.3，结果随公告库更新可能变化。`metadata.dependencies` 是锁文件树规模，不能当成生产镜像包清单。

公告来源为 `https://api.github.com/advisories/<GHSA-ID>`；registry 来源为 `https://registry.npmjs.org/<包名>/<版本>`。取证清单保留返回内容哈希，不公开 npm 配置、凭据或业务数据。

重跑内存探针时，把 `.mjs.txt` 复制到临时目录并改为 `.mjs`，在仓库根目录执行 `node <临时脚本绝对路径> <临时结果绝对路径>`。它对现有漏洞行为作断言；升级或回补 TipTap 后需重新解释预期，不应把它直接注册为长期产品测试。首次探针读取未公开的 `@tiptap/core/package.json` 子路径失败，改为只读本地包元数据后通过；属于取证脚本问题，不是产品运行失败。

本轮未执行 build、全量测试、Docker、真实浏览器、真实模型、恢复或发布；也未对服务执行攻击载荷。GitHub 公告中的示例属于原始上游资料，本轮没有运行这些示例。
