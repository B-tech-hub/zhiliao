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
- `.github/workflows/release.yml`：已有原生双架构，但使用缓存且直接发布；补强范围见计划第 5 节。
- `.github/workflows/ci.yml`：PR 推送自动触发完整门禁，远端运行确认须包含它。
- `Dockerfile`、`.dockerignore`：全新构建和数据隔离依据；不复制生成声明。
- `scripts/smoke-fresh-install.ps1`：固定镜像与隔离安装参考。
- `docs/验收证据/release-gates-061-20260929-a/`：只读复用门禁 3 身份、换行例外和成绩。

## Tasks & Acceptance

**Execution:**
- [x] P：新增 `scripts/verify-release-gate4.mjs` 和 `tests/config/release-gate4.test.ts`；补强 `release.yml`，同步 `CONTRIBUTING.md` 与配套计划，局部验证后呈交 diff。
- [ ] V：获准后同步候选与 PR CI，记录被验证的实际提交。
- [ ] R：另获发布授权后完成双架构无缓存构建、manifest 与匿名安装；归档到 `docs/验收证据/r3-gate4-061-<run-id>/`，同步执行清单、候选定稿、Release Notes 和索引。

**Acceptance Criteria:**
- Given 固定候选，When 干净获取和安装，Then 输入可追溯，缓存边界与生成文件单列。
- Given 两种原生 Linux，When 构建运行，Then 平台、原生模块和最小安装矩阵均通过。
- Given RC 分发物，When 核对索引并独立拉取，Then 两种架构、digest、revision 一致且持久化/MCP 版本通过。
- Given 失败或缺证，When 汇总，Then 如实保留未通过项及清理结果，不扩大既有证据。

## Spec Change Log

## Design Notes

用户已批准 P 阶段本地实现及局部检查；V/R 仍待分别确认。本规格为独立 R3 工作包，不同步 Story/Sprint。当前 HEAD 的 275 项源码与门禁 3 一致；新工具和发布材料提交后重新绑定身份。现有 Release 单架构退让注释与当前双架构门禁冲突，按门禁执行，详见配套计划第 4 节。

## Verification

P 仅运行新增配置的定向测试、目标脚本语法/ESLint、版本校验与文档检查；不运行 build 或全量测试。V/R 的命令、时限、证据和停止条件见配套计划第 5–7 节；执行前提交具体确认单。

P 阶段结果见[本地准备证据](../../docs/验收证据/r3-gate4-preparation-20260929-a/README.md)和[串行自审](review-r3-gate4-preparation.md)。授权仅覆盖 P，因此全规格保持 `in-progress`，不把工具准备判为运行验收通过；冻结块保持批准时原文。

2026-09-29 接续已核对待提交 P 改动、原清单 14 项及远端 PR #12，复用原 61 项通过结果；仅同步交付文档，未提交、推送或重跑测试。具体 [V 执行单](../../docs/R3门禁4候选推送与PR-CI执行单-2026-09-29.md)已准备，等待本地提交、候选推送及自动 PR CI 的确认；V/R 状态不变。旧 CI 的 head 与实际 checkout 不同，新运行必须分别留证。
