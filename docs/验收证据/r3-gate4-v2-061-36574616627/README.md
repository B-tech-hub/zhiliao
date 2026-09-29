# R3 门禁 4：V2 首次执行失败归档

**已完成一次提交和候选推送，但自动 PR CI 未通过：880 项通过、1 项失败、28 项跳过，构建未执行。** 用户明确要求按[修复后执行单](../../R3门禁4修复后候选推送与PR-CI执行单-2026-09-29.md)执行 V2；本轮保持单 Agent，应用三路径原始证据保留补丁，提交已审阅的 55 个路径并一次普通推送。失败后没有重跑、修复测试或追加提交；V2 验收及门禁 4–6 仍未关闭。

## 提交与运行身份

| 对象 | 实际值 |
|---|---|
| 候选分支 | `candidate/0.6.1-baseline` |
| 提交 / PR head | `82b1e5a1b98d4b687d8604a84c47c8ec416bf818` |
| 唯一父提交 | `321f770b523773e3f93a56dcf4fd2b1f78213ca5` |
| main / PR base | `6ee67532deed37fda6cc98962e8df76c98659890` |
| 实际 CI checkout | `a3390562caa032aabe893a34321131060540705f` |
| 候选与 checkout 的相同 tree | `324efa98630217a18b019f9dc6d2f1dd4be81a9e` |
| PR / CI | [#12](https://github.com/B-tech-hub/zhiliao/pull/12) / [36574616627](https://github.com/B-tech-hub/zhiliao/actions/runs/36574616627)，attempt 1，`pull_request`，failure |
| job 时间（UTC） | `2026-09-29T13:23:04Z` 至 `2026-09-29T13:24:04Z`，60 秒 |

[candidate.json](candidate.json)保存完整身份和 55 项文件的 Git blob/工作树哈希；[staged-inputs.json](staged-inputs.json)保留提交前清单，[git-tree.txt](git-tree.txt)列出 1716 个 Git 文件对象。提交后工作树干净，只有一个新提交。实际 checkout 从日志中的 `git log -1 --format=%H` 取得，再用 [Git commit API](checkout-commit.json)核对两个父提交及 tree，没有用事后 merge ref 回填。

[local-before.json](local-before.json)、[remote-before.json](remote-before.json)及[推送前复核](remote-prepush.json)证明批准输入、hooks 与候选/main/PR 符合执行单；[push.json](push.json)记录唯一一次推送，显式禁止附带 tag。[推送后](remote-after.json)与[结束时](remote-final.json)远端候选均等于本次提交，main 未移动，PR 仍开放。

## 原始证据保留

准备清单逐项匹配后，仅在 `.gitattributes` 追加三个精确 `-text` 规则。`bash-init.json`、`checks.json`、`tool.json` 的 SHA-256、原始 blob 与暂存/提交 blob 完全一致，见 [attributes-applied.json](attributes-applied.json)。没有重编码原 JSON、重写旧清单或扩大为目录级例外。

执行前记录了 1014 个既有证据文件（包括上一轮新增的 3 份准备附件），见 [preservation-before.json](preservation-before.json)。本轮收尾保留检查见 [closeout-checks.json](closeout-checks.json)；旧 P/V、上下文修复和 V2 准备归档均保持原字节。

## PR CI 实际结果

| 检查 | 结果 |
|---|---|
| `npm ci` | 通过；恢复了 npm 缓存 |
| `npm run check:version` | 通过 |
| `npm run check:design` | 通过 |
| `npm run lint` | 通过 |
| `npm test` | **880 通过、1 失败、28 跳过**；64 文件通过、1 文件失败、3 文件跳过 |
| `npm run build` | **skipped**，测试失败后未执行 |

环境为 Ubuntu 24.04.5 LTS，runner image `20260920.314.1`，Node.js `22.23.2`、npm `10.9.8`。x64 由 setup-node 工具路径和缓存 key 佐证，没有额外运行架构探针。`REQUIRE_DOCKER_COMPOSE=1` 保持，Release gate4 的 25 项和 release-version 的 39 项测试均在这次 CI 中通过；不能用这 64 项局部成功覆盖全量失败。

28 个跳过与旧 V 的类别相同：语料验收 23 项、T1 2 项、T0 1 项、Linux 不适用的 Windows PowerShell 2 项。没有新增跳过或放宽门禁。安装日志仍报告 33 moderate；推送返回的默认分支 Dependabot 提示是另一种口径，两者都不作为本轮独立依赖分诊结果。

## 首次失败与后续最小范围

失败位于 [`tests/config/smoke-fresh-install.test.ts:110`](../../../tests/config/smoke-fresh-install.test.ts#L110) 的“默认包版本：输出正确镜像，且不依赖运行目录或环境版本”。日志报告 **5244 ms** 和 `Test timed out in 5000ms.`，其余 10 个预览用例通过。完整证据和只读归因见 [failure-analysis.json](failure-analysis.json)。

已确认的事实：

- 该测试用 `spawnSync` 执行 PowerShell `-PrintConfig`，子进程上限为 **10000 ms**；测试没有局部超时配置，外层本次按 **5000 ms** 超时。
- 当前测试文件、预览脚本和 `vitest.config.mts` 与前一候选字节一致；旧 CI `36567105695` 中同一用例以 **2106 ms** 通过。本次第一条用例耗时超过外层上限。
- 该组是参数/零部署副作用预览测试，使用临时目录并拦截 Docker；不能将它描述为真实容器安装失败。日志未记录默认版本用例所有断言的独立完成状态，仍按测试失败处理。

尚不能确定 PowerShell 启动、runner 负载或其他因素分别贡献多少耗时；没有新计时对照，不能认定只是偶发失败。

建议下一步仅处理该测试文件的时间预算：保留子进程 10000 ms 上限及现有参数、输出、零副作用断言；记录子进程状态/耗时，并为调用 PowerShell 的用例设置包含外层开销的局部预算，例如 15000 ms。先确认这一最小范围，再定向运行该文件 11 个用例；不修改全局 Vitest 超时、不增加重试或跳过。后续完整 PR CI 仍按新提交范围安排，不能回填本次失败。**以上未实施，也未执行局部复验。**

## Release 观察与归档边界

[最终同提交查询](final-runs.json)在 `2026-09-29T13:30:04.239408+00:00` 只发现这次 PR CI，未发现新的 Release run。旧 Release `36567100870` 失败继续保留；本次“未发现”不等于 Release 成功，也没有运行 `$GITHUB_ENV` 初始化、双架构镜像、GHCR 分发或匿名安装矩阵。

[ci-log.txt](ci-log.txt)保存 `gh run view --log` 返回的 55609 个原始字节，SHA-256 为 `dcc06101e168474e8025495aa1ca0c2dd6093cdcab8d82460120fe56902a37f3`。Actions 原有脱敏标记和转义序列原样保留；可读摘录见 [log-excerpts.json](log-excerpts.json)，完整性与审阅边界见 [log-integrity.json](log-integrity.json)、[archive-review.json](archive-review.json)。[artifacts.json](artifacts.json)记录未上传 artifact，不虚构测试 JSON 或构建产物。

[summary.json](summary.json)记录失败及未执行项目；[run.json](run.json)、[jobs.json](jobs.json)和初始/轮询记录保留真实状态。[files.sha256.json](files.sha256.json)是本目录文件清单，排除自身。原始文件从临时取证目录按字节复制，没有重编码。

本次用户“执行 V2”的具体授权覆盖相应提交、推送及自动 CI，优先于 BMad 通用步骤中的禁止远端操作提示；单 Agent 和 R 边界保持。规格继续 `in-progress`，不推进 Story/Sprint。本目录及结果文档只留本地，未再次提交或推送；未 rerun、取消、合并 main、创建 tag 或发布。
