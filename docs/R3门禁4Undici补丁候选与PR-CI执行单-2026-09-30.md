---
title: R3 门禁 4 Undici 补丁候选与 PR CI 执行单
created: 2026-09-30
status: prepared-awaiting-approval
---

# R3 门禁 4：Undici 补丁候选与 PR CI

**准备完成，尚未执行。建议从固定 main 提交 M 创建独立补丁分支，一次提交、一次推送、新建一个 PR，并观察由 PR 创建触发的一次完整 CI。** PR #12 已合并，不能复用其原授权或假定向旧候选分支推送就会触发 PR CI。M 后再合并、新 main CI、RC/tag/GHCR/Release 均不在本单内。

本单只申请下述具体执行范围；用户“继续”在本轮用于调查与准备，不直接启动 Git 写操作或完整门禁。[准备证据及精确输入](验收证据/r3-gate4-undici-candidate-preparation-20260930-a/README.md)保留实际查询、旧证据保留和文件哈希。执行前须再次核对引用与权限，不把准备时结果视为永久有效。

## 1. 已核对的身份与最小改动

| 对象 | 固定值或实际状态 |
|---|---|
| 当前工作区 | `D:/ClaudeProjects/ai_acknowladge`，保留所有已有修改，不切换分支或暂存。 |
| 本地分支 / HEAD C | `candidate/0.6.1-baseline` / `41cf296d1d1ccc38d1b2f1b3335cc5b8ac4a4b81`。 |
| 远端 main / M | `2ae66f5f3df6b0e7afa3bfa09bf601b18ea96a11`；本轮官方 API 与 ls-remote 一致。 |
| C/M 的相同 tree | `d0f16de6459461315c0b0274a8a0f44bc483e84d`；因此当前 C 上的限定文件差异可复制到 M。 |
| 旧 PR / main CI | #12 已 MERGED；main CI `36647162597`、attempt 1、push、success；只属于旧锁文件。 |
| 新分支 | `candidate/0.6.1-undici-7.29.1`；准备时远端不存在，也没有同 head 的历史或开放 PR。 |
| 新候选工作目录 | `C:/Users/BAIBAI/AppData/Local/Temp/zhiliao-undici-candidate-20260930-a`；准备时不存在，若执行时已存在则停止，不复用或删除。 |
| Git 作者 / 提交者 | `BAIBAI <BAIBAI2024826@outlook.com>`；沿用有效身份，时间由实际提交产生。 |
| GitHub 操作者 / 权限 | `B-tech-hub`；push 权限为 true，仓库未归档，default branch=main。不据此声称发布权限或额度已验。 |
| 唯一推送目标 | `https://github.com/B-tech-hub/zhiliao.git`。 |

代码/依赖层面只有 `package-lock.json` 的 `node_modules/undici` 三字段：version、resolved、integrity，7.29.0 → 7.29.1。`package.json`、应用源码、测试、Vitest 配置、CI、Release 和 Dockerfile 均未改变。其余输入是 F/M 结果、high 调查、补丁验证、当前准备资料与相关文档；这些是提交补丁所引用的追溯材料，不是新增产品功能。

修复后锁文件 SHA-256 固定为 `347f5fda89ca590091ba62211c2cd40e845abaa93d4e1d79a3e0c8395424813e`。应用版本保持 0.6.1，未更改 Node、基础镜像或业务能力。

## 2. 输入、复用证据与未决风险

唯一提交集合见 [inputs.json](验收证据/r3-gate4-undici-candidate-preparation-20260930-a/inputs.json)：逐项路径、字节数、SHA-256、原始 Git blob 与当前过滤后的 blob，加清单自身。清单为最终准备快照；文件缺失、增加、哈希漂移或过滤转换即停止，不能用旧 F/V 的 70/61 路径清单，也不能 `git add .`、`git add -A` 或 `commit -a`。

已完成的只读检查没有发现待提交原始证据的 Git 字节转换；本轮不需要 `.gitattributes` 补丁。隔离 checkout 仍须在实际暂存后逐项核对 blob 的原字节，不能只比较文件名或 `git diff` 文本。

复用[Undici 局部证据](验收证据/r3-gate4-undici-patch-20260930-a/README.md)：两次审计均为 33 moderate、0 high、0 critical。8 份 jsdom 测试首轮 **95/1**；失败场景新旧版本定向对照各 2 项通过，跨运行有 96 项通过证据，但没有一次 96/0 的整组全绿。约 72 秒延迟原因未确定，原 5 秒时限、断言及首次失败保留；新的完整 CI 要继续运行该用例，不能过滤、跳过或放宽预算。

工作区 node_modules 仍含旧 Undici，不能直接在原工作区跑测试并声称验证新包。本单不刷新原工作区 node_modules，也不重复本机局部/完整测试；新 CI 的 `npm ci` 将使用本次锁文件实际安装。此前 F/M 的 884/0/28 与构建成功按原 tree 保留，不改记为新补丁的门禁成绩。

npm 包补丁不修复 Node 内置 Undici。旧 CI Node 22.23.2 上游映射为 6.28.0，本机内置为 6.21.2，均落入 WebSocket 公告的 6.x 范围；现有源码静态核对未发现触发路径。实际 RC 镜像的 Node/Undici 与适用性须在 R 前或 R 的已批准范围另行核对，本单不因此升级工具链或改变工作流。

## 3. 获批后的执行步骤

### 3.1 再核对并建立独立 checkout

再次只读确认 M、C、旧 PR 已合并、新分支及新 PR 不存在、操作者与 push 目标符合第 1 节。原工作区所有清单文件、锁文件、HEAD/refs/index 与准备指纹相符；存在漂移先返回新差异，不自动 rebase、merge、重生成清单或覆盖数据。

在原工作区之外创建第 1 节的新目录，用独立 Git 仓库获取固定 M；只 fetch 这个提交，不取 tag，不改变原工作区 refs。下面命令在该新目录内逐条执行，任一非零立即停止：

```powershell
git init
git remote add origin https://github.com/B-tech-hub/zhiliao.git
git fetch --depth=1 --no-tags origin 2ae66f5f3df6b0e7afa3bfa09bf601b18ea96a11
git switch --no-track -c candidate/0.6.1-undici-7.29.1 FETCH_HEAD
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
```

要求实际 HEAD=M、tree=T；若远端 main 已前进或新目录污染则停止。检查隔离仓库的有效身份、hooks 与 Git 过滤配置，不能绕过活动 hook；若 hook 将运行未包含在本单内的本机重验证，先停止并说明。所有命令输出存放在该 checkout 之外的本次证据目录，避免成为待提交输入。

### 3.2 复制精确输入并创建一次提交

按 inputs.json 逐项读取原工作区文件，校验哈希，复制原始字节到独立 checkout；不得复制 `.env`、data、node_modules、`.next` 或整个工作区。复制后逐文件复核内容，并单独复制清单自身、记录它的 SHA-256。

仅暂存清单路径及清单自身。使用 NUL 分隔路径文件与 `git add --pathspec-from-file=<仓库外路径文件> --pathspec-file-nul`，或逐路径显式暂存；必须核对暂存集合恰等于清单、每个 blob 与原字节一致、锁文件仅三个字段变化、没有删除或额外文件。暂存前后 `git diff --check` 可作为轻量静态核对，不能替代 CI。

一次提交建议消息：

```text
fix: 更新 Undici 补丁并归档 R3 主线验收证据
```

取得完整新提交 U，要求唯一父提交为 M；读取 U 的 tree 和全部清单路径 blob，与批准输入逐一对应。U 的值只能由真实 `git rev-parse HEAD` 获取，不预填、amend 或追加修复提交。原工作区仍保持现状，结果文件不倒写到已冻结的提交输入。

### 3.3 一次新分支推送与新建一个 PR

推送前再次核对 main=M、目标分支不存在、有效操作者与唯一 push URL 正确。仅普通推送一次，不推 main、tag，不 force/mirror，不删除或复用旧候选分支：

```powershell
git push --porcelain origin HEAD:refs/heads/candidate/0.6.1-undici-7.29.1
```

成功后读取远端新分支必须等于 U。请求结果不明确时先查询远端状态，不能盲目重推；若新分支已存在但状态不符则保留现场并停止。

将本目录内已审阅的 [pr-body.md](验收证据/r3-gate4-undici-candidate-preparation-20260930-a/pr-body.md)原字节复制到仓库外临时文件，通过 `--body-file` 新建一个普通 PR，base=main、head=新分支：

```powershell
gh pr create --repo B-tech-hub/zhiliao --base main --head candidate/0.6.1-undici-7.29.1 --title "fix: 修复 Undici 高危依赖并归档验收证据" --body-file <仓库外正文文件>
```

正文中的 CI 待运行是创建时的事实，不预写成功结果。创建请求失败或结果不明确时，先查询同 head PR，不重复创建；只记录实际新 PR 号与 URL。不要自动 merge、启用 auto-merge、改旧 PR #12 或删除分支。

### 3.4 观察一次自动 PR CI

现有 CI 在 PR 创建时触发：Ubuntu 托管 runner、Node 22、npm cache、`npm ci`、版本检查、`check:design`、lint、`REQUIRE_DOCKER_COMPOSE=1` 的全部测试、build/TypeScript。这次授权必须明确包含完整 CI；原工作区不代跑，工作流和测试不修改，不手动 dispatch/rerun。

按实际新 PR、U 查询全部相关 runs，确认唯一目标为 `ci.yml`、`pull_request`、attempt 1，仓库、head/base、操作者和触发事件一致。取得实际 PR checkout P2 及 tree；CI 通常测试合并引用，不能把 API head_sha 当成 checkout。前后 main 必须仍为 M，P2 的 tree 必须与 U 相同，否则停止后续合并与 R 评估。

读取真实日志、jobs/steps 与 artifacts，核对锁文件身份、Undici 安装/告警线索和测试结果。既有日志若只给安装汇总，不宣称其输出了实际包版本；锁文件身份与 npm ci 语义单列。预期用例集合未变，参考 F/M 的 884 通过、28 原条件跳过，但最终数字必须来自新 run；出现新 high/critical、异常跳过、用例数量变化或原超时再现时保留首次结果并停止后续阶段，不自动加审计、改依赖、改测试或重跑。

## 4. 时限、失败与归档

| 项目 | 约束 |
|---|---|
| 执行数量 | 一个独立 checkout、一次提交、一次新分支推送、一个新 PR、一轮自动完整 CI。 |
| 本机验证 | 仅身份、字节、暂存和 diff 静态核对；不安装依赖、不跑测试/构建/Docker。 |
| run 出现 / 排队 | 创建 PR 后最多 10 分钟等待出现；目标 run 连续排队最多 30 分钟。 |
| job / 总墙钟 | job 最多 60 分钟；从 PR 创建起总计最多 100 分钟，取证归档另计；这是人工监控上限，不声称工作流配置了额外硬限制。 |
| 观察 | 30–60 秒一次只读查询；额度、权限或策略不足时停止，不充值或切换更大 runner。 |
| 取消 | 超时或意外工作流仅可定向取消本次已核对 PR/U 对应的新 run，并查询终态；不取消历史或其他提交，不强制取消或自动 rerun。 |

任一失败、身份漂移、缺证、超时、未执行 build 或新告警均不判定本阶段通过。失败可能留下独立 checkout、新提交、新分支或 PR；保留实际状态，不自动删除、回滚或追加修复。已推送但 PR 创建失败不算 CI 完成。

终态资料另归档到 `docs/验收证据/r3-gate4-undici-candidate-061-<实际run-id>/`；无 run 则使用独立 attempt 目录，不能覆盖本准备目录或旧证据。保存批准清单、M/U/P2/tree/parents、实际 Git/平台身份、推送与 PR 响应、run/attempt/jobs/steps、原始日志和哈希、环境/缓存、实际测试及跳过、告警、取消与残留状态。没有 artifact 如实记录零；不保存凭据或完整环境。

结果文档只留本地，不通过新提交改变 U。通过标准是明确输入上的一次真实完整 PR CI 成功且证据相符；不是把局部首轮 95/1 擦掉，也不是发布就绪。随后合并新 PR 与新 main CI 单独安排，再重新形成最终 RC 身份和 R 范围；规格仍为 `in-progress`，原 baseline、冻结块和 Story/Sprint 保持。
