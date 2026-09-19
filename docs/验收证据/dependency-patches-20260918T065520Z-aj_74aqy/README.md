# 依赖安全补丁与局部验证证据

日期：2026-09-18。对应[实施规格](../../../_bmad-output/implementation-artifacts/spec-r1-dependency-security-patches.md)和[分诊与补丁报告](../../依赖告警分诊-2026-09-18.md#dependency-patches)。用户已批准单 Agent 实施及局部验证；应用版本保持 `0.6.1`，尚未发布。

Next.js/ESLint 配置 `15.5.24`、Sharp `0.35.4`、传递开发依赖 js-yaml `4.3.2`、Vitest `4.1.11` 已应用。锁文件更新 48 个必要包，总包数保持 875；实际增量安装更新 17 个本机包，生命周期脚本禁用。全量与生产审计均为 **32 moderate、0 high、0 critical**，65 项定向测试、8 文件 ESLint 和版本校验通过。

| 文件 | 内容 |
|---|---|
| [summary.json](summary.json) | 版本、环境、审计统计、测试结果和验收边界 |
| [dependency-changes.patch](dependency-changes.patch) | 相对本轮实施前包文件副本的完整差异，不混入既有 Git 改动 |
| [lock-scope-review.json](lock-scope-review.json) | 接受的 48 个包变化，以及临时解析时排除的 59 处无关变更 |
| [dependency-check.json](dependency-check.json) | 最终包文件指纹、Linux 可选包与 SQLite/jieba 原生模块保留核对 |
| [installed-manifest.json](installed-manifest.json) | 最终文件 SHA-256、10 个关键安装版本与锁定版本对照 |
| [applied-manifest.json](applied-manifest.json) | 应用时、统一 LF 前的文件指纹；最终字节以 installed-manifest 为准 |
| [baseline-meta.json](baseline-meta.json)、[workspace-before.json](workspace-before.json) | 本轮开始时 HEAD、索引、原生模块及 981 个文件的指纹，不含文件正文 |
| [targeted-tests.report.json](targeted-tests.report.json)、[targeted-lint.report.json](targeted-lint.report.json) | Vitest 与 ESLint 的原始机器报告 |
| [commands/](commands/) | 每条命令的原始参数、时间、退出码、stdout/stderr；审计 JSON 在对应 `.stdout.log` 中 |
| [.gitignore](.gitignore) | 仅允许本目录 `commands/*.log` 随证据交付，覆盖根目录的通用日志忽略规则 |
| [harness/](harness/) | 环境隔离执行包装器与 Sharp 版本探针；以 `.txt` 归档 |
| [review.md](review.md)、[review-context.json](review-context.json) | 按批准范围完成的单 Agent 自审及差异快照，不是独立多 Agent 审查 |
| [verification.json](verification.json) | 文档链接、文本格式、冻结块及工作区保留核对 |
| [artifact-manifest.json](artifact-manifest.json) | 本目录所有证据文件 SHA-256，不包含清单自身 |

## 复核结果

全量审计于 `07:10:27–07:10:31 UTC`，生产审计于 `07:10:45–07:10:47 UTC`。两者使用 npm 官方 registry，正常返回 JSON；退出 `1` 是因为剩余 TipTap moderate，全部关联 `GHSA-cp6q-959q-f8rh`。命令如下，执行时实际通过记录中的 Node/npm 路径调用：

```powershell
npm.cmd audit --json --package-lock-only --include=dev --include=optional --include=peer --ignore-scripts --registry=https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=30000
npm.cmd audit --json --package-lock-only --omit=dev --include=optional --include=peer --ignore-scripts --registry=https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=30000
```

`metadata.dependencies` 表示锁文件树规模，不是生产镜像内包清单。[修补前取证](../dependency-triage-20260918T063915Z-93d2673e/README.md)中的全量 37 / 生产 34 项和六份公告保留，不用本次查询改写历史时点。

4 个定向测试文件分别为 `auth` 4 项、`vision-images` 4 项、`demo-boundary` 44 项、`settings-panel-hydration` 13 项，合计 **65/65 通过，无跳过**，只启用一个 worker。ESLint 覆盖这些测试及 `src/lib/auth.ts`、`src/lib/vision-images.ts`、`src/middleware.ts`、`src/app/(app)/settings/settings-panel.tsx`，`--max-warnings=0` 通过。测试中既有的 Vite `__dirname` / future native config loader 提示完整保留。

Sharp 在 Windows x64 实际加载 `0.35.4`、libvips `8.18.6`、libheif `1.23.2`；Linux x64/arm64 的 glibc/musl 可选锁条目均保留，但没有运行 Linux 二进制或镜像。

## 解析过程与证据边界

最初三次临时锁解析均遇到 npm `10.9.3` Arborist 的 `Cannot read properties of null (reading 'edgesOut')`，命令及 stderr 保存在 `commands/resolve-lock*`。临时限定获批版本与原 Vite `8.2.1` 后解析成功；只采用 48 个必要包变化并移除临时约束，普通 `install --package-lock-only` 再次通过且锁文件哈希不变。最终文件统一为 UTF-8、LF，与解析复核文件的 JSON 内容一致；没有升级 npm，也没有使用 `--force` 或 `--legacy-peer-deps`。

原始命令元数据与日志按原字节归档。执行包装器清除模型、鉴权和业务目录环境变量，为测试使用内存库及临时目录；没有归档业务配置、密钥或数据。归档中的本机绝对路径用于追溯原命令，跨环境复跑需改为对应路径并重新检查隔离条件。

本轮保留核对发现讨论目录 `.memlog.md` 有同期外部改动，并新增 `brainstorm.html`，已单列在 `verification.json`，未覆盖或计入依赖补丁。其余批准范围外的基线文件、旧证据、HEAD、索引及 Story/Sprint 保持。

本轮没有执行 build、全量测试、Docker、真实浏览器、真实模型或 R1/R2 运行验收，没有生成新候选镜像。TipTap 风险未豁免，旧镜像和旧运行结果不代表新依赖已通过运行验收；正式四条门禁及完整发布要求保留。
