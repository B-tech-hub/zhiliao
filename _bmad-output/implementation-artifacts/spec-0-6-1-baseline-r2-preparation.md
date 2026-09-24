---
title: '0.6.1 候选收口与 R2 验收准备'
type: 'chore'
created: '2026-09-23'
status: 'done'
baseline_commit: '6ee67532deed37fda6cc98962e8df76c98659890'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/0.6.1收口与R2验收计划-2026-09-23.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 候选表落后于 R1 修复与证据，最终基线未固定，R2 缺可执行验收安排。

**Approach:** 保留历史，补齐变化与证据映射、B1 审查和清理，准备同一候选的出口与恢复验收。详见 context 中计划；本规格只批准准备阶段。

## Boundaries & Constraints

**Always:** 单 Agent；先批准后实现；复用 R1 分项证据；UTF-8/LF；保护已有改动。

**Ask First:** 新产品修复、build、全量测试、Docker/浏览器演练、模型调用和对外发布。

**Never:** 重写历史、改历史 JSON、接触正式数据或凭据、把 ZIP 当整库恢复、提前关闭 R2/R3。

</frozen-after-approval>

## Code Map

- `docs/0.6.1候选范围核对-2026-09-22.md`：范围决定与方案 A；当前事实已过期。
- `src/lib/client-note.ts:7`：B1 转换入口；三页调用已存在，回归见下方任务。
- `src/lib/ai/source-refusal.ts:22`、`src/lib/ai/chat-stream.ts:89`：未提交的 R1 拒答与工具轮补丁。
- `src/lib/backup.ts:68`：数据库后复制图片，非原子配对。
- `src/lib/markdown-export.ts:24`：写 Markdown，不回填全库。
- `src/lib/export.ts:76`、`src/lib/import.ts:228`：ZIP 图片、元数据往返与判重。
- `docs/备份与恢复.md:104`：独立空卷、离线恢复模板。
- `scripts/verify-r1-core-loop.mjs:739`：基线 SHA 写死；历史结果不证明最终工作树身份。
- `docs/R2出口与恢复操作单-2026-09-23.md:36`：`R2` 包装带参数特性，PowerShell 5.1 截获 `-d`/`-e`；就绪只靠注释。
- `src/lib/backup.ts:35`：启动 5 分钟后自动备份并清扫；备份名取 UTC 日期。
- `src/lib/note-write.ts:202`：改正文会重新入队整理与向量，由 seal 清理。

## Tasks & Acceptance

**Execution:**
- [x] `docs/0.6.1候选范围核对-2026-09-22.md`：追加当前事实，登记 R1 产品补丁，保留原决定。
- [x] `_bmad-output/implementation-artifacts/review-client-note-closure.md`：补实际 B1 单 Agent 审查结论；复核 `tests/components/client-note-pages.test.tsx` 与 `tests/lib/client-note.test.ts`。
- [x] `tsconfig.json`、`_st.mjs`、`.gitignore`：落实已决定的局部清理，保留无关改动；候选清单分组且记录文件哈希。
- [x] `docs/0.6.1收口与R2验收计划-2026-09-23.md`：补具体命令、资源名、样本与判据，提交重验证审批。
- [x] `docs/releases/v0.6.1.md`、`CHANGELOG.md`、`docs/README.md`、`docs/产品规划/开源发布范围与执行清单-2026-09-13.md`：同步候选、R1 组合证据及 R2 待执行状态；必要时更新恢复手册。
- [x] `docs/R2出口与恢复操作单-2026-09-23.md`：包装改为无参数特性的简单函数；补有上限的就绪等待、构建前清单核对、正式实例与卷前后快照、端口检查、日志与镜像记录，以及 5 分钟自动备份与 UTC 换日提示。
- [x] `docs/验收证据/0.6.1-baseline-2026-09-23/r2/fixture.cjs`：seed 增加改正文，等待 Markdown 出现新正文且旧正文消失。
- [x] `docs/验收证据/0.6.1-baseline-2026-09-23/README.md`：新建证据索引，含候选身份与复核、命令与结果、R1 映射、六组提交清单和忽略文件说明。
- [x] 局部检查：PowerShell 5.1 桩函数干跑操作单、准备脚本 dryrun、`node --check`、`compare.py` 自测、清单复核、编码与链接。

**Acceptance Criteria:**
- Given 当前工作树，When 收口清单，Then 每组都有来源、实际审查、适用证据和发布说明，提示词不算审查结果。
- Given 历史 R1，When 复用，Then T1540 失败记录原样保留，T0114 仅补引用/拒答，最终补丁用局部回归核对。
- Given R2 准备稿，When 审批运行，Then 固定镜像、三套隔离资源、样本、零外部模型、出口/恢复判据和失败保留步骤可核对；缺条件不执行。
- Given Windows PowerShell 5.1，When 用桩 docker 干跑操作单全部命令，Then 参数完整透传，就绪等待有上限且失败即停。
- Given 引用证据索引的四份文档，When 打开链接，Then README 存在并列出候选身份、命令结果、R1 映射与六组提交清单。

## Spec Change Log

- 2026-09-23：用户确认准备阶段及局部验证，进入实施。保持单 Agent；未授权重验证或发布；本任务不绑定 Story，不改 Sprint 状态。
- 2026-09-23（续）：复核发现操作单在 PowerShell 5.1 下截获 `-d`/`-e` 且缺就绪等待，证据 README 缺失，改正文、正式实例快照与构建前核对未覆盖，补为后四项任务。用户确认续用本规格、在当前工作区继续、加一次准备脚本 dryrun，审查通过后在本地分支分组提交。

## Verification

- 本轮仅检查计划文件编码、链接与 Git 状态。
- 批准准备阶段后，按计划第 5 节做 B1、R1 补丁及文档的局部检查；测试单 worker。
- R2 实测与原四条发布门禁分别待确认；不重跑 R1 模型矩阵。
- 审查通过后：在本地分支 `candidate/0.6.1-baseline` 按证据 README 的六组逐组显式暂存提交，不推送、不打 tag；提交前扫描凭据。

## Suggested Review Order

**PowerShell 包装与就绪等待（阻断修复）**

- 入口：简单函数以 `$args` 透传，`up -d`、`node -e` 不再被截获
  [`R2出口与恢复操作单:37`](../../docs/R2出口与恢复操作单-2026-09-23.md#L37)

- 就绪等待先校验角色，最多 60 次，用尽才停
  [`R2出口与恢复操作单:43`](../../docs/R2出口与恢复操作单-2026-09-23.md#L43)

- 每次 up 后先等就绪，不用业务步骤试错
  [`R2出口与恢复操作单:121`](../../docs/R2出口与恢复操作单-2026-09-23.md#L121)

- 构建段 try/finally 恢复 Stop，stderr 进度写入 build.log
  [`R2出口与恢复操作单:104`](../../docs/R2出口与恢复操作单-2026-09-23.md#L104)

**证据保护与正式实例边界**

- 证据只新建不覆盖，重复执行保留第一次结果
  [`R2出口与恢复操作单:55`](../../docs/R2出口与恢复操作单-2026-09-23.md#L55)

- 正式容器 zhiliao 与非本轮卷的前后快照
  [`R2出口与恢复操作单:63`](../../docs/R2出口与恢复操作单-2026-09-23.md#L63)

- 结束时比对快照，有变化即停
  [`R2出口与恢复操作单:240`](../../docs/R2出口与恢复操作单-2026-09-23.md#L240)

- 构建前核对独立目录与 272 文件清单
  [`R2出口与恢复操作单:99`](../../docs/R2出口与恢复操作单-2026-09-23.md#L99)

- 密码换窗口读取，入库不复制 env
  [`R2出口与恢复操作单:247`](../../docs/R2出口与恢复操作单-2026-09-23.md#L247)

**试跑脚本**

- 启动或重启后，下一条必须是就绪检查
  [`sheet-dry-run.ps1:92`](../../docs/验收证据/0.6.1-baseline-2026-09-23/sheet-dry-run.ps1#L92)

- 四个反例：超时、未知角色、证据覆盖、正式实例变化
  [`sheet-dry-run.ps1:52`](../../docs/验收证据/0.6.1-baseline-2026-09-23/sheet-dry-run.ps1#L52)

- 桩 docker 只记录参数，不触达真实 Docker
  [`sheet-dry-run.ps1:19`](../../docs/验收证据/0.6.1-baseline-2026-09-23/sheet-dry-run.ps1#L19)

**R2 容器脚本**

- 短文先存初稿再改正文，覆盖增量 Markdown 的改正文路径
  [`fixture.cjs:87`](../../docs/验收证据/0.6.1-baseline-2026-09-23/r2/fixture.cjs#L87)

- 等新文本出现、旧文本消失；export-backup 复用
  [`fixture.cjs:39`](../../docs/验收证据/0.6.1-baseline-2026-09-23/r2/fixture.cjs#L39)

- 断言五组模型环境变量都不存在
  [`inspect.cjs:16`](../../docs/验收证据/0.6.1-baseline-2026-09-23/r2/inspect.cjs#L16)

**证据索引、审查与状态同步**

- 候选身份与两次清单复核
  [`README.md:5`](../../docs/验收证据/0.6.1-baseline-2026-09-23/README.md#L5)

- 六组提交清单与跨组文件归属
  [`README.md:66`](../../docs/验收证据/0.6.1-baseline-2026-09-23/README.md#L66)

- 单 Agent 审查结论与 7 项补丁
  [`review-0-6-1-baseline-r2-preparation.md:5`](review-0-6-1-baseline-r2-preparation.md#L5)

- 计划文档的当前结论
  [`0.6.1收口与R2验收计划:101`](../../docs/0.6.1收口与R2验收计划-2026-09-23.md#L101)

- 执行清单第 14 节的复核条目
  [`开源发布范围与执行清单:260`](../../docs/产品规划/开源发布范围与执行清单-2026-09-13.md#L260)
