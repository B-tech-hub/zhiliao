---
title: 'v0.6.1 最终候选发布门禁收尾'
type: 'chore'
created: '2026-09-29'
status: 'done'
baseline_commit: '6e79059ff825bb2f0ae5c76d6cb818e6da497d04'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="用户于 2026-09-29 全部批准核对报告第 1–3 步及完整门禁">

## Intent

**Problem:** 最终候选四条门禁缺证；工作树有两处验证修正，旧清单含未入库的生成文件。

**Approach:** 审查并局部验证已有修正，固定隔离副本输入，执行完整门禁，同步候选与证据。

## Boundaries & Constraints

**Always:** 单 Agent、单测试 worker；保留旧证据、用户改动和正式数据；UTF-8/LF；原发布标准不降级。

**Ask First:** 扩大产品行为、依赖或部署范围。

**Never:** 本工作包不推送、打 tag、发布，不重跑已覆盖浏览器或恢复矩阵，不改 Story/Sprint 状态。

</frozen-after-approval>

## Code Map

- `eslint.config.mjs`：已有 `docs/**` 排除，收窄到验收证据中的 CJS 归档，保留其他脚本检查。
- `tests/config/demo-verification-utils.test.ts`：已有 `vi.hoisted` / `vi.mock` 修正，保留进程参数与信号断言。
- `tests/components/settings-page-demo.test.tsx`、`tests/config/demo-http-probes.test.ts`：首轮稳定复现的测试观测错误，分别检查页面返回参数、逐请求字节数。
- `scripts/demo-verification-utils.mjs`：产品工具行为不变。
- `package.json`、`.github/workflows/ci.yml`：版本、四条门禁及 `REQUIRE_DOCKER_COMPOSE=1`。
- `next.config.ts`、`tsconfig.json`：独立构建；`next-env.d.ts` 由工具链生成。
- `docs/验收证据/0.6.1-heic-read-2026-09-27/candidate-inputs.json`：只读旧清单，276 项。
- `docs/0.6.1候选定稿-2026-09-28.md`、`docs/releases/v0.6.1.md`、`docs/产品规划/开源发布范围与执行清单-2026-09-13.md`：候选与门禁事实。

## Tasks & Acceptance

**Execution:**
- [x] 两处已有修正：审查并运行目标测试和 lint。
- [x] `docs/验收证据/release-gates-061-20260929-a/`：隔离副本、输入哈希、命令日志和结果；区分可复现输入与生成文件。
- [x] 同一隔离候选：版本校验、设计检查、完整 lint、全量测试、构建；失败按原因最小修复并记录复验。
- [x] 候选定稿、Release Notes、执行清单、文档索引和 CHANGELOG：同步真实结果，保留门禁 4–6。
- [x] 本规格与审查记录：核对原文件保护、证据边界和完成状态。

**Acceptance Criteria:**
- Given 两处已有修正，When 局部验证，Then 原进程行为断言通过且源码检查仍有效。
- Given 固定输入的隔离副本，When 四条完整门禁执行，Then 全部成功并记录环境、输入、退出码和日志。
- Given 旧镜像与本次验证输入不同，When 查阅文档，Then 可分辨各自身份、复用范围及尚未完成的发布验收。

## Spec Change Log

- 2026-09-29：首轮全量检出两处测试观测错误及一次编辑器超时；局部复跑重现前两处，编辑器原时限通过。按已批准的门禁失败最小修正范围修正测试，保留产品行为、原安全断言和原时限。

## Design Notes

已获本轮实施和重验证授权，不重复请求技能检查点批准；用户单 Agent 约束优先，直接实施并串行自审。复用本机依赖只用于门禁 3，不算无缓存安装。隔离副本不带正式 env、data 或旧构建产物；生成声明单独留证。旧清单与旧镜像身份保持。

## Verification

- 局部：Demo 进程辅助测试和两份修改文件的 ESLint。
- 完整：`npm run check:version`、`npm run check:design`、`npm run lint`、`npm test -- --maxWorkers=1 --no-file-parallelism`、`npm run build`。
- 静态：输入哈希、生成文件、文档链接与 `git diff --check`；失败日志保留。

**结果：** 四条完整门禁通过，858 项通过、26 项原专项跳过；41 项定向回归通过。最终源码清单 `0c3dd6fecf14eb53218e85e061ad51737b612e886e5114243320cf49495c1d10`，源码提交 `75eeb32b1943c7e54c32e20b416bc7fb8a61f178`。保留首轮三个失败与两项测试修正，不改编辑器时限。完整结果见[运行记录](../../docs/验收证据/release-gates-061-20260929-a/README.md)，串行自审见[审查记录](review-0-6-1-final-release-gates.md)。本工作包完成不代表门禁 4–6 或发布完成。

## Suggested Review Order

- 先看输入身份、命令结果和发布边界。
  [README.md:1](../../docs/验收证据/release-gates-061-20260929-a/README.md#L1)
- 区分旧镜像与最终源码门禁。
  [0.6.1候选定稿-2026-09-28.md:12](../../docs/0.6.1候选定稿-2026-09-28.md#L12)
- 检查归档排除范围。
  [eslint.config.mjs:22](../../eslint.config.mjs#L22)
- 检查真实页面返回给客户端的参数。
  [settings-page-demo.test.tsx:34](../../tests/components/settings-page-demo.test.tsx#L34)
- 检查五个请求的独立计数。
  [demo-http-probes.test.ts:44](../../tests/config/demo-http-probes.test.ts#L44)
