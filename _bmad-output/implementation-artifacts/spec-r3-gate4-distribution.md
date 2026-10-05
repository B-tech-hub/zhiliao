---
title: 'R3 门禁 4：无缓存分发与原生双架构验收'
type: 'chore'
created: '2026-09-29'
status: 'in-progress'
baseline_commit: '549f45200081f9c50b3d658e4c8d1a7c695bde04'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="用户确认前为草案；分阶段授权">

## Intent

**Problem:** 门禁 3 通过，独立 Linux、无缓存分发、双架构与 manifest 尚缺证据。

**Approach:** 使用用户已选的 GitHub 原生 amd64/arm64 runner，按配套计划的 P 本地准备、V 候选 CI、R RC 无缓存分发推进，复用同一轮双架构构建。

## Boundaries & Constraints

**Always:** 单 Agent；两平台顺序运行；固定完整提交和 digest；只用合成数据；保留旧证据。

**Ask First:** 当前只申请 P 的本地实现及局部检查。V 的推送与重验证、R 的合并/tag/GHCR/Release 分别确认；业务或依赖变更另议。

**Never:** 接触正式数据；用缓存、QEMU 或单架构冒充验收；覆盖旧 tag；自动关闭门禁 5–6 或 Story/Sprint。

</frozen-after-approval>

## Code Map

- `docs/R3门禁4Undici补丁候选与PR-CI执行单-2026-09-30.md`：新候选准备已完成；以固定 M 为父提交建立独立分支/checkout，清单、一次提交/推送/新 PR 与完整 CI 待确认，不复用已合并 PR #12。
- `docs/R3主线新增high依赖调查-2026-09-30.md`：已获准应用 Undici 7.29.1 最小锁文件补丁；两次审计均 0 high，局部首次 95/1 与新旧版本定向对照各 2 项通过分别留证，Node 内置副本及 R 边界保留。
- `package-lock.json`：仅 node_modules/undici 的 version、resolved、integrity 三字段更新；package.json、源码、测试和工作流不变。
- `docs/R3门禁4合并main与CI执行单-2026-09-30.md`：M 已确认执行，一次普通合并及 main CI 通过；原方案保留，归档时 high 待定位，后续结论见独立调查，不含 R。
- `docs/验收证据/r3-gate4-rc-local-20260929-a/README.md`：六文件补丁已确认应用；67 项局部测试、目标 ESLint、actionlint 和版本校验通过，未提交或运行 R。
- `docs/R3门禁4最终候选收口与RC执行单-2026-09-29.md`：当前 F/M/R 入口；F/M 旧 tree 成绩保持，新增 high 最小补丁已本地应用，新候选完整 CI、RC/GHCR 与真实 R 仍待确认。
- `docs/R3门禁4预览预算修复后候选推送与PR-CI执行单-2026-09-29.md`：V3 已获准执行，61 路径一次提交/推送及自动完整 CI 通过；原方案保留。
- `docs/R3门禁4环境调查与验收计划-2026-09-29.md`：环境、完整身份、命令语义、矩阵和资源边界，执行前必读。
- `docs/R3门禁4候选推送与PR-CI执行单-2026-09-29.md`：V 的待提交路径、推送命令、PR head/merge 身份、监控阈值和确认边界。
- `docs/R3门禁4修复后候选推送与PR-CI执行单-2026-09-29.md`：V2 已按 55 路径提交并推送；首次 CI 因安装预览测试超时失败，结果与后续边界见独立归档。
- `.github/workflows/release.yml`：已补强原生双架构无缓存构建与安装；本轮修正路径初始化及失败上传目录，范围见计划第 5 节。
- `tests/config/release-gate4.test.ts`：上下文层级、初始化顺序、上传目录和匿名存储的局部守卫。
- `tests/config/smoke-fresh-install.test.ts`：11 个 PowerShell 预览用例采用局部 15 秒测试预算，子进程 10 秒上限及原断言保留。
- `.github/workflows/ci.yml`：PR 推送自动触发完整门禁，远端运行确认须包含它。
- `Dockerfile`、`.dockerignore`：全新构建和数据隔离依据；不复制生成声明。
- `scripts/smoke-fresh-install.ps1`：固定镜像与隔离安装参考。
- `docs/验收证据/release-gates-061-20260929-a/`：只读复用门禁 3 身份、换行例外和成绩。

## Tasks & Acceptance

**Execution:**
- [x] Undici 新候选准备：只读核对 main=M、旧 PR #12 已合并、目标新分支/PR 不存在；复用补丁局部结果，生成精确输入及新执行单，无 Git 字节转换风险。未 fetch、暂存、提交、推送、新建 PR、审计、测试或发布；新候选执行及后续合并/R 分别确认。
- [x] Undici 最小补丁：用户确认后仅更新锁文件三字段到 7.29.1；校验官方产物并在独立副本验证实际 jsdom 解析。8 文件首轮 95/1，失败场景新旧版各 2 项通过，原超时及未定原因保留；两次修复后审计均 33 moderate、0 high。未修改测试时限、断言、工作流或工作区 node_modules，未提交/推送/完整 CI/R。
- [x] M 后 high 调查：单 Agent 复用 F/M，通过两次只读锁文件审计定位 Undici 7.29.0；全依赖 33 moderate + 1 high，排除开发依赖 33 moderate、0 high。公告、触发条件、Node 内置副本和最小处理方案独立归档；未改依赖或执行提交/推送/完整门禁/R。
- [x] P：新增 `scripts/verify-release-gate4.mjs` 和 `tests/config/release-gate4.test.ts`；补强 `release.yml`，同步 `CONTRIBUTING.md` 与配套计划，局部验证后呈交 diff。
- [x] V：已获准同步候选 `321f770`，PR CI `36567105695` 通过并归档实际 checkout；同时记录 Release 工作流解析阻断，不能进入 R。
- [x] V 后修复：四个临时路径移到 build/install 首个初始化步骤，补上下文与初始化顺序回归，固定初始化失败时的上传目录；64 项局部回归通过并独立留证。
- [x] V2 准备：审阅修复后差异，复用原局部证据，形成新执行单；三份原始 JSON 的 Git 换行转换风险已附精确补丁草案，未应用。
- [x] V2 首次执行：已获准应用证据保留补丁，提交 55 路径为 `82b1e5a1b98d4b687d8604a84c47c8ec416bf818` 并一次推送；CI `36574616627` 的失败及实际 checkout 已归档。
- [x] V2 后局部修复：用户确认后将 11 个预览用例的外层预算设为 15 秒，保留子进程 10 秒上限及全部断言；11 项定向回归和目标 ESLint 通过，单独留证，未提交或推送。
- [x] 后续候选 CI 验收（V3）：61 路径一次提交/推送，CI `36580449536` 版本及四条门禁通过，881/0/28，预览 11 项全部通过；旧 V2 首次 880/1/28 失败保留，不回填。
- [x] V3 准备：单 Agent 审阅预览预算修复及结果文档，复用已有局部验证；新增 61 路径执行单和输入清单，未暂存、提交、推送或重验证。
- [ ] R：另获发布授权后完成双架构无缓存构建、manifest 与匿名安装；归档到 `docs/验收证据/r3-gate4-061-<run-id>/`，同步执行清单、候选定稿、Release Notes 和索引。
- [x] R 前准备：串行审阅未提交 V3 结果文档，形成最终候选收口与 RC 执行单；发布材料定稿方案、Git 身份、main/RC、GHCR、匿名安装、资源和失败边界已列出，未执行提交、推送、重验证或发布。
- [x] R 前本地实施：用户确认后精确应用六文件补丁；显式原生平台成功依赖与材料定稿完成，67 项局部测试、目标 ESLint、actionlint、版本校验通过并独立归档；未执行 F/M/R。
- [x] F：70 路径一次提交/推送，PR CI `36585198727` 全绿，884/0/28；旧证据保持，M/main CI 与真实 R 未执行。
- [x] M 准备：只读核对 C/B、PR、F 状态与仓库合并设置，固定完整 28 提交/704 路径范围，形成 2026-09-30 执行单；未合并或重验证。
- [x] M：用户确认后一次普通 merge，M `2ae66f5f3df6b0e7afa3bfa09bf601b18ea96a11`；main CI `36647162597` 884/0/28、构建通过，parents/tree/checkout 相符。1193 份旧证据保持，结果仅本地；新增 1 high 摘要待定位，R 未执行。

**Acceptance Criteria:**
- Given 固定候选，When 干净获取和安装，Then 输入可追溯，缓存边界与生成文件单列。
- Given 两种原生 Linux，When 构建运行，Then 平台、原生模块和最小安装矩阵均通过。
- Given RC 分发物，When 核对索引并独立拉取，Then 两种架构、digest、revision 一致且持久化/MCP 版本通过。
- Given 失败或缺证，When 汇总，Then 如实保留未通过项及清理结果，不扩大既有证据。

## Spec Change Log

- 2026-09-30：用户要求继续，本轮完成 Undici 补丁后的候选准备。main 仍为 `2ae66f5f3df6b0e7afa3bfa09bf601b18ea96a11`、tree 与本地 C 相同；PR #12 已合并，现有 CI 不响应普通候选分支 push，故拟从 M 新建 `candidate/0.6.1-undici-7.29.1` 和新 PR。只做远端只读查询、输入/过滤核对和文档准备，复用两次 0 high 与局部首轮 95/1、定向对照各 2 项通过，未重验证或写 Git。新执行单固定独立 checkout、精确清单、一次提交/推送/PR/完整 CI、失败停止及后续合并/R 边界；旧证据、原 baseline、冻结块、in-progress 和 Story/Sprint 保持。

- 2026-09-30：用户“可以”确认上轮 7.29.1 最小方案及局部验证。本轮仅修改 Undici 锁条目的 version/resolved/integrity，并同步相关文档；官方 tarball 的 SHA-512/SHA-1 与已存证元数据相符。隔离副本 8 份 jsdom 测试首次 95/1，Mermaid=true 正文同步在原 5 秒时限下记录约 72 秒超时；仅该场景新旧版本对照各 2 项通过，首次失败不回填、原因未定，未修改测试或放宽时限。全依赖/生产锁文件审计均 33 moderate、0 high、0 critical。旧证据、工作区 node_modules、refs/index、baseline、冻结块和 in-progress 保持；BMad 多 Agent、自动提交/完成规格要求服从单 Agent 与本轮局部边界，不同步 Story/Sprint，不执行完整门禁或发布。

- 2026-09-30：用户限定本轮仅调查 main 新增 high；提前说明两次锁文件审计范围后，在仓库外原字节副本查询官方 registry，并核对两条 high 公告及修复元数据。定位为开发依赖 `jsdom@29.1.1 → undici@7.29.0`，7.29.1 可兼容修复；Node 22.23.2 上游内置 6.28.0 另落入 WebSocket 公告范围，未发现业务直接触发路径。新增独立报告和证据，旧归档保持；未修改依赖、代码、工作流或运行测试/构建/发布。BMad 通用子 Agent 和全规格完成要求服从本轮单 Agent 调查范围；原 baseline、冻结块、`in-progress` 及 Story/Sprint 保持。

- 2026-09-30：用户明确确认 M 执行单，已一次普通合并 PR #12，main 为 `2ae66f5f3df6b0e7afa3bfa09bf601b18ea96a11`；CI `36647162597` 全绿，884/0/28，实际 checkout=M，parents=[B,C]、tree 与 F 相同。安装摘要 33 moderate + 1 high，未预判包/原因或追加审计，R 前待定位复评。旧 1193 份证据/附件保留；单 Agent，无本地提交/推送/rerun/tag/GHCR/Release，原 baseline、冻结块、`in-progress` 与 Story/Sprint 保持。

- 2026-09-30：用户要求继续，按 F/M/R 分段边界完成 M 准备。C `41cf296d1d1ccc38d1b2f1b3335cc5b8ac4a4b81` 与 B `6ee67532deed37fda6cc98962e8df76c98659890` 未变，PR 可合并、F 全绿；main 无保护规则，执行单要求人工核对门禁及合并前后身份。单 Agent，复用 F，1158 份旧证据及准备附件原字节保留；未合并、提交、推送、运行新 CI 或发布，M 待确认，原 baseline、冻结块、`in-progress` 和 Story/Sprint 保持。
- 2026-09-29：用户批准按 F 推荐执行，已应用 V3 原始 JSON 的单路径字节保护；70 路径提交为 `41cf296d1d1ccc38d1b2f1b3335cc5b8ac4a4b81` 并普通推送一次。CI `36585198727` 版本及四条门禁通过，884/0/28，实际 checkout `4548fe4c1be2f6dcea52501bfd2a559244a68174` 与候选 tree 一致；1124 份旧证据及准备文件保持。单 Agent，无本机重验证/rerun/main/tag/GHCR/Release；结果仅本地归档，原 baseline、冻结块和 `in-progress` 保持，M/R 待具体授权。

- 2026-09-29 F 准备补充：发现 V3 原始 `run.json` 含一个 CRLF，直接暂存会改变归档哈希；新增单路径 `.gitattributes -text` 补丁方案及隔离属性对照，真实文件未改。F 清单纳入该待应用项，共 70 路径；旧证据原样保留，执行时须先应用已列明规则再逐项核对暂存字节。

- 2026-09-29：用户要求接续本地验收，已串行准备[最终候选 F 执行单](../../docs/R3门禁4最终候选提交与PR-CI执行单-2026-09-29.md)及精确路径清单；只读核对远端候选/main、PR #12、身份/权限与 hook，复用 67 项局部成绩。未暂存、提交、推送、重验证或发布；F 的一次提交/推送及自动完整 CI 待确认，M/R 独立授权，原 baseline、冻结块和状态保持。

- 2026-09-29：用户确认六文件补丁及限定局部检查，已精确应用；显式原生平台成功依赖、两份配置守卫、RC 共用材料与维护文档落地。隔离副本内 67/0/0、目标 ESLint、已验证本地 actionlint 1.7.7 及两次版本校验通过；未下载依赖/工具、未运行完整门禁或 Docker、未提交推送发布。新结果独立归档，旧证据和准备附件保留；baseline、冻结块、`in-progress` 及 Story/Sprint 保持，下一步为 F 的最终输入审阅。

- 2026-09-29：用户要求继续，沿用仅准备边界，产出[六文件补丁草案](../../docs/patches/r3-gate4-rc-20260929/README.md)：显式原生平台成功依赖、两份配置守卫、RC 材料定稿与维护文档。仅完成差异审阅与补丁适用性检查，未应用补丁或运行测试/校验器；原工作流、旧证据、baseline、冻结块和 `in-progress` 保持。具体本地实施及局部检查范围已列明，等待确认。

- 2026-09-29：按用户要求仅准备最终候选收口与 R 执行单，同步当前入口，旧证据原文保持。审阅发现矩阵 `max-parallel: 1` / `fail-fast: false` 不保证原计划的 amd64 先行与首失败停止；列为 R 前待解决差异，本轮不改工作流。BMad 子 Agent、完成全规格和验证指示按用户本轮范围收窄；保留原 baseline、冻结块、`in-progress`，不推进 Story/Sprint。
- 2026-09-29：用户授权执行 V3，61 路径提交并推送为 `b2bae00d4a0e91ef43a0cb41f70f75ebc38ec592`；自动 CI `36580449536` 通过，881/0/28，11 个预览用例通过，构建成功。旧失败及 1064 份原证据保持，未重跑或发布；具体 V3 授权覆盖相应远端动作，单 Agent、baseline、冻结块和 R 边界保持。结果文档仅留本地。

- 2026-09-29：用户要求仅准备新一轮候选同步。新增 V3 执行单，保留 V2 首次失败与全部旧证据；不复用已执行的 55 路径方案。按用户要求收窄 BMad 后续实现及子 Agent 指示，只做串行审阅和文档准备；baseline、冻结块、`in-progress`、Story/Sprint 和 R 边界保持。
- 2026-09-29：用户同意处理安装预览测试的局部超时预算；只修改该测试文件的外层时限为 15 秒，两组共 11 个用例均适用。10 秒子进程上限、参数与零副作用断言、全局 Vitest 配置和工作流保持；临时 observer 记录实际子进程状态/耗时，11 项定向测试与目标 ESLint 通过。旧 V2 失败原样保留，未提交、推送或重跑完整 CI；原 baseline、冻结块、单 Agent 和 R 边界保持。
- 2026-09-29：用户明确要求按修复后执行单执行 V2；完成三份 JSON 精确字节保护、55 路径单次提交及候选推送。新 CI `36574616627` 在安装预览测试超时失败，构建 skipped；保持首次失败并完成只读归因和归档，没有 rerun、追加修复或发布。具体 V2 授权优先于 BMad 通用禁止远端操作提示，单 Agent、原 baseline、冻结块及 R 边界保持；结果文档只留本地。
- 2026-09-29：用户要求本轮仅准备新提交、候选推送和自动 PR CI 执行单。单 Agent 审阅当前差异并复用已有 64 项局部成绩，未重新验证或执行外部动作；发现三份原始 JSON 会被 Git 换行转换，仅提供 `.gitattributes` 三路径补丁草案。本轮同步执行单、计划、规格和索引，保留全部旧证据、原 baseline、冻结块和 `in-progress`；V2 实际执行与 R 均待后续确认。
- 2026-09-29：用户确认 Release 四处上下文错误的最小本地修复与局部验证。仅修改工作流、配置测试及相关文档；采用首步骤通过 `RUNNER_TEMP` 写入 `GITHUB_ENV`，不提前创建目录。BMad 的子 Agent 指示按用户明确要求改为单 Agent 串行实施与自审；原 baseline、冻结块及 P/V 证据保持，后续提交/推送、重验证和 R 仍另行确认。
- 2026-09-29：用户确认 V 的一次提交/推送和完整 CI；已执行并归档。冻结块保留原 P 批准文本；R 尚未获准，Release 上下文缺陷的修复与下一次推送另按新差异安排。

## Design Notes

当前接续为[Undici 新候选执行单](../../docs/R3门禁4Undici补丁候选与PR-CI执行单-2026-09-30.md)，仅准备完成；原 PR #12 已合并，新分支、新 PR 和新 CI 尚未创建。不能将本轮“继续”当作完整 CI 或 Git 写入授权，具体执行须按最终清单确认。

当前已归档 M 为 `2ae66f5f3df6b0e7afa3bfa09bf601b18ea96a11`，main CI `36647162597` 通过，884/0/28。其后本地已应用 Undici 7.29.1 最小锁文件补丁、两次审计均 0 high；局部首次超时与新旧版本对照见[补丁证据](../../docs/验收证据/r3-gate4-undici-patch-20260930-a/README.md)。修改尚未提交，M 的完整 CI 不能归给新锁文件；新候选与 R 仍待具体安排，Node 内置副本未修复。所有准备与 F 状态段落保留其历史时点。

F 候选为 `41cf296d1d1ccc38d1b2f1b3335cc5b8ac4a4b81`，完整 CI `36585198727` 通过，884/0/28；随后 M 已完成，R 未执行。下方 V3 与更早记录保留历史身份。

此前 V3 候选为 `b2bae00d4a0e91ef43a0cb41f70f75ebc38ec592`，完整 PR CI 已通过；此前 V2 安装预览超时失败保持历史原义。本规格为独立 R3 工作包，不同步 Story/Sprint。Release 的真实双架构构建与安装仍未执行；最新 R 前准备见[收口与 RC 执行单](../../docs/R3门禁4最终候选收口与RC执行单-2026-09-29.md)，最终发布提交不能预填为 V3 HEAD。原单架构退让注释的冲突处理见配套计划第 4 节，现有矩阵调度与严格失败停止的差异见新执行单第 2 节。

## Verification

Undici 补丁：官方包哈希与实际解析通过；8 文件首轮 95 通过、1 超时，失败场景新旧版本各 2 项通过；跨运行有 96 项通过证据，不声明一次整组全绿。仅新增两次修复后锁文件审计，均 33 moderate、0 high；源码/测试/工作流及旧证据不变，完整 CI/R 未运行。具体限制见[归档](../../docs/验收证据/r3-gate4-undici-patch-20260930-a/README.md)。

M 后调查仅新增两次官方源只读锁文件审计和静态核对，未重跑测试或构建；[新证据](../../docs/验收证据/r3-gate4-high-triage-20260930-a/README.md)不回填 F/M 的安装摘要。旧通过成绩继续按原 tree 复用。

P 仅运行新增配置的定向测试、目标脚本语法/ESLint、版本校验与文档检查；不运行 build 或全量测试。V/R 的命令、时限、证据和停止条件见配套计划第 5–7 节；执行前提交具体确认单。

P 阶段结果见[本地准备证据](../../docs/验收证据/r3-gate4-preparation-20260929-a/README.md)和[串行自审](review-r3-gate4-preparation.md)。全规格保持 `in-progress`；冻结块保持 P 批准时原文，后续 V 授权见变更记录。

V [运行归档](../../docs/验收证据/r3-gate4-v-061-36567105695/README.md)：版本和四条门禁通过，878/28；PR checkout 与候选 tree 一致。Release `36567100870` 在解析时失败，未启动 job，归档四处错误与修复建议。当轮没有改工作流或重复推送，归档保持原样。

V 后[本地修复证据](../../docs/验收证据/r3-gate4-runner-context-20260929-a/README.md)：actionlint 对照复现原四处错误、修复后通过；最终两份测试 64/0/0，Bash 初始化对照及目标 ESLint 通过。单 Agent 自审补充上传路径失败保护，未运行 build、全量测试、Docker 或远端工作流。原 baseline 与冻结块保持；修复和 V 证据仍未提交或推送，门禁 4–6 未关闭。

历史准备：2026-09-29 曾核对待提交 P 改动、原清单 14 项及远端 PR #12，复用原 61 项通过结果，当时仅准备 [V 执行单](../../docs/R3门禁4候选推送与PR-CI执行单-2026-09-29.md)。其后的确认与运行结果以上方 V 归档为准。

本次 [V2 准备记录](../../docs/验收证据/r3-gate4-v2-preparation-20260929-a/README.md)及[新执行单](../../docs/R3门禁4修复后候选推送与PR-CI执行单-2026-09-29.md)：已有修复输入与归档哈希匹配，未重跑验证；提交前须先按已附草案保护三份原始证据的字节。实际 `.gitattributes` 尚未修改，暂存、提交、推送及远端 CI 均未执行。

以上 V 后修复与 V2 准备段落保留各轮历史状态。[V2 执行归档](../../docs/验收证据/r3-gate4-v2-061-36574616627/README.md)记录一次提交/推送与 CI `36574616627`：实际 checkout `a3390562caa032aabe893a34321131060540705f` 与候选 tree 相同；880/1/28，构建未执行。三份原始 JSON 在 Git 中保留原字节；同候选查询未发现新 Release run，不视为 Release 通过。当轮仅提出预算修复；随后局部修复已完成，最新接续见 [V3 准备记录](../../docs/验收证据/r3-gate4-v3-preparation-20260929-a/README.md)，提交、推送与完整 CI 尚未执行。

最新 [V3 执行归档](../../docs/验收证据/r3-gate4-v3-061-36580449536/README.md)记录实际 checkout `b9d45eed96cd5cd574962e215500dcc67b0f9bc7` 与候选 tree 一致。版本及四条门禁通过，881/0/28；前述各轮“尚未提交/推送”保留历史原义。R 与门禁 4–6 仍未完成，结果文档不自动追加提交。

## Suggested Review Order

最新先读[新候选执行单](../../docs/R3门禁4Undici补丁候选与PR-CI执行单-2026-09-30.md)与[精确输入](../../docs/验收证据/r3-gate4-undici-candidate-preparation-20260930-a/inputs.json)，核对从 M 建独立分支、新 PR 的 CI 触发及失败边界；再回溯下列补丁和历史证据。

当前先核对[锁文件三个字段](../../package-lock.json#L11616)，再读[补丁证据](../../docs/验收证据/r3-gate4-undici-patch-20260930-a/README.md)，重点区分首次 95/1、定向对照与两次 0 high 审计；最后核对 Node 内置副本和新候选 CI/R 边界。以下顺序保留历史轮次含义。

当前先读[M 执行单](../../docs/R3门禁4合并main与CI执行单-2026-09-30.md)与[准备记录](../../docs/验收证据/r3-gate4-main-preparation-20260930-a/README.md)，再按下列入口回溯 F 与历史证据。M 已按后续确认执行，实际身份见[M 归档](../../docs/验收证据/r3-gate4-main-061-36647162597/README.md)；原准备记录不回写。

最新先读[RC 前本地验收](../../docs/验收证据/r3-gate4-rc-local-20260929-a/README.md)，再审阅显式 job 依赖与两平台配置守卫。此前矩阵顺序/失败停止差异已在本地修复，RC 共用文字采用 2026-09-29 材料日期；下方旧轮次顺序仅供回溯，F/M/R 仍另行确认。

先读[F 结果](../../docs/验收证据/r3-gate4-final-061-36585198727/README.md)及本次文档差异，再回溯[V3 结果](../../docs/验收证据/r3-gate4-v3-061-36580449536/README.md)，再读[最终候选收口与 RC 执行单](../../docs/R3门禁4最终候选收口与RC执行单-2026-09-29.md)及本次文档差异。预览测试预算修复已随 V3 提交并通过完整 CI，不再列为待提交。下列路径仅供回溯原上下文修复；全规格保持 `in-progress`，未来实现、提交/推送/完整 CI 与 R 按具体范围确认。

- 先看前置初始化，确认四个路径只供后续步骤使用。
  [release.yml:84](../../.github/workflows/release.yml#L84)

- 失败上传使用固定目录，不依赖初始化成功。
  [release.yml:287](../../.github/workflows/release.yml#L287)

- 核对层级限制、初始化顺序及原隔离守卫。
  [release-gate4.test.ts:155](../../tests/config/release-gate4.test.ts#L155)

- 查看局部成绩、原证据保留与远端验证边界。
  [README.md:1](../../docs/验收证据/r3-gate4-runner-context-20260929-a/README.md#L1)
