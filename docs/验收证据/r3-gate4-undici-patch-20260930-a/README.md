# R3 Undici 7.29.1 最小补丁与局部验证

**用户确认后，仅更新锁文件中 `node_modules/undici` 的 version、resolved、integrity 三个字段，7.29.0 → 7.29.1。修复后两次锁文件审计均为 33 moderate、0 high、0 critical，Undici 告警消失。** `package.json`、应用源码、测试、Vitest 配置与工作流未改，没有新增 override 或直接依赖。

对应[调查与处理记录](../../R3主线新增high依赖调查-2026-09-30.md)。[修复前审计](../r3-gate4-high-triage-20260930-a/README.md)、F/M 通过成绩和更早失败保留原字节。本轮只有单 Agent、限定局部验证与文档同步，没有提交、推送、完整门禁、Docker 或发布；规格保持原 baseline、冻结块及 `in-progress`，不改 Story/Sprint。

## 输入与隔离

- 本地 HEAD 仍为 `41cf296d1d1ccc38d1b2f1b3335cc5b8ac4a4b81`，修改后的锁文件尚未提交。旧 M 的 tree 不能作为本轮依赖已完成完整 CI 的证据。
- 修复后锁文件 SHA-256 为 `347f5fda89ca590091ba62211c2cd40e845abaa93d4e1d79a3e0c8395424813e`；[lock-change.json](lock-change.json)结构化验证仅一条包记录、三个字段变化，并保留 `dev: true` 和 engines。
- Windows，Node 22.19.0、npm 10.9.3；将现有 node_modules 独立复制到仓库外，排除缓存和旧 Undici，再从官方 registry 下载 7.29.1 tarball，SHA-512、SHA-1 均匹配上一轮存证元数据。只解包普通文件，不运行生命周期脚本。
- 复制源码、测试与必要配置，不复制 `.env`、数据库、上传或导出内容；子进程清除模型与业务路径环境，测试沿用内存数据库和 mock。`--maxWorkers=1` 保持单 worker，未改仓库测试配置。
- [resolution.json](resolution.json)证明从隔离 jsdom 的入口解析到隔离的 Undici 7.29.1，并满足 `^7.25.0`。工作区原 node_modules 未刷新，仍为 Undici 7.29.0；后续在工作区运行依赖相关验证前须按新锁文件安装，不能把旧包当作新补丁。
- 这是复用已有依赖的局部验证，不是全新 `npm ci`、无缓存安装或实际 RC 镜像验收。

## 实际测试结果

| 运行 | 实际结果 | 解释 |
|---|---|---|
| 7.29.1，8 份 jsdom 文件首次运行 | **95 通过、1 失败、0 跳过**；7 文件通过、1 文件失败，Vitest 总时长 140.10 秒 | Mermaid=true 的“外部正文同步通过实际 setContent 路径过滤属性”触发原有 5000 ms 时限，记录耗时 72083.7558 ms；不是安全断言内容不符。原失败与 stderr 保留。 |
| 7.29.1，仅正文同步两态对照 | 2 通过、0 失败、24 因名称过滤未运行 | Mermaid=false 139.68 ms、true 44.28 ms；不将过滤项计作通过。 |
| 7.29.0，同一隔离副本的旧版对照 | 2 通过、0 失败、24 因名称过滤未运行 | Mermaid=false 138.54 ms、true 44.55 ms；对照后已恢复隔离包和锁文件到 7.29.1。 |

8 份文件为 `tests/components/` 下的 api-token-section、command-palette、markdown-editor-security、nav、quick-capture、settings-panel-hydration，以及 `tests/lib/mermaid.test.ts`、`tests/lib/tiptap-security.test.ts`。完整 argv 与时限见各 `*.command.json`。

首次运行后没有修改源码、测试、断言或 5 秒时限；只对失败场景做新旧版本对照，没有重跑其余已通过用例。修复版的 96 个用例跨两次运行均取得通过证据，**但不存在一次 96/0 的整组全绿结果**。不能把跨运行覆盖改记成首轮成功，也不能由一次对照断言间歇性超时已修复。

[test-analysis.json](test-analysis.json)还摘录 9 月 29 日旧门禁中同文件 Mermaid=true 的“初次加载”用例约 71 秒异常：这是不同用例的既有现象，不能当成当前超时同因的证明。当前 72 秒延迟原因仍未确定；新旧版本局部对照未观察到稳定回归，后续新候选 CI 应继续保留原时限核对。Vite native loader、React flushSync 与 prefetch 的提示均未抑制。

## 审计与剩余边界

两次审计使用修改后的原字节锁文件，按调查阶段已说明的命令串行执行：全依赖 `--include=dev`、生产集合 `--omit=dev`，均带 `--package-lock-only --ignore-scripts`，只查询 npm 官方 registry，20 秒网络超时、零自动重试。两次退出 1 均源于 33 moderate，JSON 有效、stderr 为空；无 high/critical 且无 Undici 条目。不是修复了全部 moderate，也不是实际镜像安全审计。

与修复前报告相比，剩余告警的包名、等级、公告、版本范围及节点保持；四项 TipTap 的 `effects`/`fixAvailable` 归因不同，详见 [audit-comparison.json](audit-comparison.json)。没有执行这些修复建议，也不声称两份报告除 Undici 外逐字段相同。

Node 内置 Undici 没有随 npm 包更新：本机实际 `process.versions.undici=6.21.2`，旧 CI Node 22.23.2 上游映射为 6.28.0，二者均落在 WebSocket 公告的 6.x 范围内。调查未发现业务触发路径；实际 RC 镜像的 Node/Undici 版本与适用性仍在 R 中核对，本轮不升级 Node 或基础镜像。

最小补丁已落地，新增 npm high 已消除；首次局部超时保留且原因未定。新候选提交/推送、完整 CI 与 R 仍需按具体范围继续，不复用旧 tree 的完整门禁作为新锁文件成绩。

## 证据与自审

- `identity-before.json`、`preservation-before.json`、`workspace-installed-before.json`：原 HEAD/refs/index、已有文件和工作区 jsdom/Undici 的指纹。
- `download-integrity.json`、`isolation.json`、`resolution.*`：官方包校验、隔离方式和实际模块解析。
- `test-inputs.json`、`verification-preservation.json`：与工作区相同的源码/测试/配置输入，以及测试后未变化的核对。
- `jsdom-tests.*`、`vitest-results.json`：首次 95/1 原始 stdout/stderr、命令和报告，不覆盖。
- `focused-patched.*`、`focused-baseline.*`、`focused-summary.json`：新旧版本的限定对照、精确身份及隔离环境恢复。
- `audit-all-after.*`、`audit-production-after.*`：两次修复后审计的原始输出、时间、退出码和摘要。
- `closeout-checks.json`：单 Agent 自审核对最小锁差异、元数据/产物一致、两次审计、用例覆盖、首次失败保留、旧证据与 refs/index 不变；不声称独立审查。
- `harness/` 保留实际取证脚本为 `.txt`；`files.sha256.json` 记录所有归档文件哈希，排除自身。

本目录由仓库外原始结果逐字节复制而来。既有证据不回写，文档明确区分本轮局部补丁、旧 CI、首次失败与后续对照。
