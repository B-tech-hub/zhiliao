# R3 门禁 4：V3 候选同步与 PR CI

**V3 已通过：一次提交、一次候选推送，自动 PR CI 的版本检查和四条完整门禁全部成功；881 项通过、0 失败、28 项原条件跳过。** 用户授权按 [V3 执行单](../../R3门禁4预览预算修复后候选推送与PR-CI执行单-2026-09-29.md)执行，保持单 Agent，没有本机重验证、CI rerun、合并、tag、GHCR 或发布。门禁 4–6 和 R 仍未完成。

## 身份与输入

| 对象 | 实际身份 |
|---|---|
| 候选分支 | `candidate/0.6.1-baseline` |
| 提交 / PR head | `b2bae00d4a0e91ef43a0cb41f70f75ebc38ec592` |
| 唯一父提交 | `82b1e5a1b98d4b687d8604a84c47c8ec416bf818` |
| main / PR base | `6ee67532deed37fda6cc98962e8df76c98659890` |
| 实际 CI checkout | `b9d45eed96cd5cd574962e215500dcc67b0f9bc7` |
| 候选与 checkout 的相同 tree | `d454fb7fd60c30e156a898be38a0d05b06c5da0a` |
| PR / CI | [#12](https://github.com/B-tech-hub/zhiliao/pull/12) / [36580449536](https://github.com/B-tech-hub/zhiliao/actions/runs/36580449536)，attempt 1，`pull_request`，success |
| job 时间（UTC） | 2026-09-29 14:08:52 至 14:11:01，约 129 秒 |

61 路径逐项匹配批准清单，暂存及提交 blob 与工作树 SHA-256 一致；清单自身哈希也纳入 [local-before.json](local-before.json)。[staged-inputs.json](staged-inputs.json)、[candidate.json](candidate.json)和 [git-tree.txt](git-tree.txt)分别保存暂存、提交和全部 Git 文件对象。提交后工作树干净，只有一个新提交。无需新增 `.gitattributes` 例外。

[remote-before.json](remote-before.json)及 [remote-prepush.json](remote-prepush.json)记录候选/main/PR 符合批准输入，PR OPEN、非草稿、MERGEABLE；未发现活动 Git hook，推送目标唯一且符合预期。[push.json](push.json)记录唯一普通推送，显式禁止附带 tag。[remote-after.json](remote-after.json)和 [remote-final.json](remote-final.json)确认候选更新、base 未动。推送后瞬时 mergeable 为 UNKNOWN，只记录 GitHub 重算状态，没有据此执行额外动作。

实际 checkout 从日志中的 `git log -1 --format=%H` 取得，再用 [Git commit API](checkout-commit.json)核对两个 parents 与 tree，未用事后 merge ref 替代。

## 实际验证结果

| 检查 | 结果 |
|---|---|
| 安装依赖 / 版本一致性 | 通过 |
| 设计 / ESLint | 通过 |
| 全量测试 | 881 通过、0 失败、28 跳过；65 文件通过、3 文件跳过 |
| 构建及 TypeScript 检查 | 通过 |
| 安装预览测试 | 11 项全部通过，整组 19093 ms |

Ubuntu 24.04.5 LTS，runner image `20260920.314.1`，Node.js `22.23.2`、npm `10.9.8`；x64 由 setup-node 路径及缓存 key 佐证。恢复了 npm 缓存，因此不是无缓存分发验收。CI 沿用既有并发和 `REQUIRE_DOCKER_COMPOSE=1`，没有注入本机 observer。

[test-results.json](test-results.json)保留 11 个预览用例的原日志摘录：默认版本 **6553 ms**，其余约 907–1630 ms。默认版本仍超过旧 5000 ms 外层预算，本次在 15000 ms 预算内通过；源码的 10000 ms 子进程上限、原参数和零副作用断言保留。报告耗时不是独立子进程计时，也不能定位启动、负载或调度各自的贡献。

28 项跳过仍为语料验收 23、T1 2、T0 1、Linux 不适用的 Windows PowerShell 2；没有新增跳过。安装报告的 33 moderate、构建的 jose Edge Runtime 警告及 Actions Node 运行时弃用提示保留在日志中，本轮未扩大依赖或工作流修复。

## 原始证据与后续边界

[ci-log.txt](ci-log.txt)保存 `gh run view --log` 返回的 73488 个原始字节，完整性见 [log-integrity.json](log-integrity.json)；可读摘录见 [log-excerpts.json](log-excerpts.json)。原始输出保留 Actions 掩码及控制序列；归档按字节复制，凭据模式和人工审阅边界见 [archive-review.json](archive-review.json)。[artifacts.json](artifacts.json)确认无上传 artifact，不虚构测试 JSON。

执行前全部 **1064 份既有证据**列于 [preservation-before.json](preservation-before.json)，收尾逐项核对见 [closeout-checks.json](closeout-checks.json)。旧 V2 的 880/1/28 失败、预算局部修复和 V3 准备目录保持原字节。新目录清单 [files.sha256.json](files.sha256.json)排除自身。

[final-runs.json](final-runs.json)仅发现本候选的这次 PR CI，未发现新 Release run；这不表示 Release 成功，也没有验证真实双架构镜像、`GITHUB_ENV` 路径消费、GHCR 分发或匿名安装。V3 成功关闭的是这次候选同步与完整 PR CI 待验收项；R 及门禁 4–6 仍需后续具体授权。

结果文档与本目录仅留本地，不自动追加提交或触发新 CI。规格保持原 baseline、冻结块和 `in-progress`，不推进 Story/Sprint。最终发布材料若产生新提交，应重新固定身份与证据适用范围。
