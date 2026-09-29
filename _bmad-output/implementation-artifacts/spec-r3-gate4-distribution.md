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

- `docs/R3门禁4环境调查与验收计划-2026-09-29.md`：环境、完整身份、命令语义、矩阵和资源边界，执行前必读。
- `docs/R3门禁4候选推送与PR-CI执行单-2026-09-29.md`：V 的待提交路径、推送命令、PR head/merge 身份、监控阈值和确认边界。
- `docs/R3门禁4修复后候选推送与PR-CI执行单-2026-09-29.md`：V2 准备单；55 路径含待应用的三份原始证据保留补丁，提交/推送/自动完整 CI 尚未执行。
- `.github/workflows/release.yml`：已补强原生双架构无缓存构建与安装；本轮修正路径初始化及失败上传目录，范围见计划第 5 节。
- `tests/config/release-gate4.test.ts`：上下文层级、初始化顺序、上传目录和匿名存储的局部守卫。
- `.github/workflows/ci.yml`：PR 推送自动触发完整门禁，远端运行确认须包含它。
- `Dockerfile`、`.dockerignore`：全新构建和数据隔离依据；不复制生成声明。
- `scripts/smoke-fresh-install.ps1`：固定镜像与隔离安装参考。
- `docs/验收证据/release-gates-061-20260929-a/`：只读复用门禁 3 身份、换行例外和成绩。

## Tasks & Acceptance

**Execution:**
- [x] P：新增 `scripts/verify-release-gate4.mjs` 和 `tests/config/release-gate4.test.ts`；补强 `release.yml`，同步 `CONTRIBUTING.md` 与配套计划，局部验证后呈交 diff。
- [x] V：已获准同步候选 `321f770`，PR CI `36567105695` 通过并归档实际 checkout；同时记录 Release 工作流解析阻断，不能进入 R。
- [x] V 后修复：四个临时路径移到 build/install 首个初始化步骤，补上下文与初始化顺序回归，固定初始化失败时的上传目录；64 项局部回归通过并独立留证。
- [x] V2 准备：审阅修复后差异，复用原局部证据，形成新执行单；三份原始 JSON 的 Git 换行转换风险已附精确补丁草案，未应用。
- [ ] V2 执行：另获确认后应用证据保留补丁，提交 55 个路径并一次候选推送，观察自动 PR CI 及同提交其他 Actions 记录，归档真实身份与结果。
- [ ] R：另获发布授权后完成双架构无缓存构建、manifest 与匿名安装；归档到 `docs/验收证据/r3-gate4-061-<run-id>/`，同步执行清单、候选定稿、Release Notes 和索引。

**Acceptance Criteria:**
- Given 固定候选，When 干净获取和安装，Then 输入可追溯，缓存边界与生成文件单列。
- Given 两种原生 Linux，When 构建运行，Then 平台、原生模块和最小安装矩阵均通过。
- Given RC 分发物，When 核对索引并独立拉取，Then 两种架构、digest、revision 一致且持久化/MCP 版本通过。
- Given 失败或缺证，When 汇总，Then 如实保留未通过项及清理结果，不扩大既有证据。

## Spec Change Log

- 2026-09-29：用户要求本轮仅准备新提交、候选推送和自动 PR CI 执行单。单 Agent 审阅当前差异并复用已有 64 项局部成绩，未重新验证或执行外部动作；发现三份原始 JSON 会被 Git 换行转换，仅提供 `.gitattributes` 三路径补丁草案。本轮同步执行单、计划、规格和索引，保留全部旧证据、原 baseline、冻结块和 `in-progress`；V2 实际执行与 R 均待后续确认。
- 2026-09-29：用户确认 Release 四处上下文错误的最小本地修复与局部验证。仅修改工作流、配置测试及相关文档；采用首步骤通过 `RUNNER_TEMP` 写入 `GITHUB_ENV`，不提前创建目录。BMad 的子 Agent 指示按用户明确要求改为单 Agent 串行实施与自审；原 baseline、冻结块及 P/V 证据保持，后续提交/推送、重验证和 R 仍另行确认。
- 2026-09-29：用户确认 V 的一次提交/推送和完整 CI；已执行并归档。冻结块保留原 P 批准文本；R 尚未获准，Release 上下文缺陷的修复与下一次推送另按新差异安排。

## Design Notes

用户已批准并完成 P/V 及后续上下文本地修复；R 仍待确认。本规格为独立 R3 工作包，不同步 Story/Sprint。调查基线的 275 项源码与门禁 3 一致；P/V 工具和材料绑定候选 `321f770`，本轮修复仍是未提交的新输入。Release 四处 job 级错误已修正，远端复验待新的候选同步；原单架构退让注释与双架构门禁的冲突处理仍见配套计划第 4 节。

## Verification

P 仅运行新增配置的定向测试、目标脚本语法/ESLint、版本校验与文档检查；不运行 build 或全量测试。V/R 的命令、时限、证据和停止条件见配套计划第 5–7 节；执行前提交具体确认单。

P 阶段结果见[本地准备证据](../../docs/验收证据/r3-gate4-preparation-20260929-a/README.md)和[串行自审](review-r3-gate4-preparation.md)。全规格保持 `in-progress`；冻结块保持 P 批准时原文，后续 V 授权见变更记录。

V [运行归档](../../docs/验收证据/r3-gate4-v-061-36567105695/README.md)：版本和四条门禁通过，878/28；PR checkout 与候选 tree 一致。Release `36567100870` 在解析时失败，未启动 job，归档四处错误与修复建议。当轮没有改工作流或重复推送，归档保持原样。

V 后[本地修复证据](../../docs/验收证据/r3-gate4-runner-context-20260929-a/README.md)：actionlint 对照复现原四处错误、修复后通过；最终两份测试 64/0/0，Bash 初始化对照及目标 ESLint 通过。单 Agent 自审补充上传路径失败保护，未运行 build、全量测试、Docker 或远端工作流。原 baseline 与冻结块保持；修复和 V 证据仍未提交或推送，门禁 4–6 未关闭。

历史准备：2026-09-29 曾核对待提交 P 改动、原清单 14 项及远端 PR #12，复用原 61 项通过结果，当时仅准备 [V 执行单](../../docs/R3门禁4候选推送与PR-CI执行单-2026-09-29.md)。其后的确认与运行结果以上方 V 归档为准。

本次 [V2 准备记录](../../docs/验收证据/r3-gate4-v2-preparation-20260929-a/README.md)及[新执行单](../../docs/R3门禁4修复后候选推送与PR-CI执行单-2026-09-29.md)：已有修复输入与归档哈希匹配，未重跑验证；提交前须先按已附草案保护三份原始证据的字节。实际 `.gitattributes` 尚未修改，暂存、提交、推送及远端 CI 均未执行。

## Suggested Review Order

本轮仅准备 V2；先审阅新执行单的 55 路径、证据保留补丁与 CI 观察范围，再按下列顺序查看原修复。全规格保持 `in-progress`，V2 执行和 R 仍待确认。

- 先看前置初始化，确认四个路径只供后续步骤使用。
  [release.yml:84](../../.github/workflows/release.yml#L84)

- 失败上传使用固定目录，不依赖初始化成功。
  [release.yml:287](../../.github/workflows/release.yml#L287)

- 核对层级限制、初始化顺序及原隔离守卫。
  [release-gate4.test.ts:155](../../tests/config/release-gate4.test.ts#L155)

- 查看局部成绩、原证据保留与远端验证边界。
  [README.md:1](../../docs/验收证据/r3-gate4-runner-context-20260929-a/README.md#L1)
