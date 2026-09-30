# R3 门禁 4：最终候选 F 提交与 PR CI

**F 已通过：70 路径一次提交、一次普通候选推送，自动 PR CI 的版本检查及四条完整门禁全部成功；884 项通过、0 失败、28 项原条件跳过。** 用户批准按[F 执行单](../../R3门禁4最终候选提交与PR-CI执行单-2026-09-29.md)执行，保持单 Agent。未运行本机重验证、CI rerun、main 合并、tag、GHCR 或 Release；M/R 与门禁 4–6 未完成。

## 身份与输入

| 对象 | 实际身份 |
|---|---|
| 分支 | `candidate/0.6.1-baseline` |
| 提交 / PR head | `41cf296d1d1ccc38d1b2f1b3335cc5b8ac4a4b81` |
| 唯一父提交 | `b2bae00d4a0e91ef43a0cb41f70f75ebc38ec592` |
| main / PR base | `6ee67532deed37fda6cc98962e8df76c98659890`，前后保持 |
| 实际 CI checkout | `4548fe4c1be2f6dcea52501bfd2a559244a68174` |
| 候选与 checkout 的相同 tree | `d0f16de6459461315c0b0274a8a0f44bc483e84d` |
| author / committer | `BAIBAI <BAIBAI2024826@outlook.com>` |
| GitHub 操作者 | `B-tech-hub` |
| PR / CI | [#12](https://github.com/B-tech-hub/zhiliao/pull/12) / [36585198727](https://github.com/B-tech-hub/zhiliao/actions/runs/36585198727)，attempt 1，pull_request，success |
| job 时间（UTC） | 2026-09-29 14:46:40 至 14:48:54，约 134 秒 |

70 路径与批准清单一致，清单自身哈希另存于[local-before.json](local-before.json)。[staged-inputs.json](staged-inputs.json)和[candidate.json](candidate.json)记录暂存及提交字节，[git-tree.txt](git-tree.txt)记录全部 Git 文件对象。提交后工作树干净，只有一个新提交。

`.gitattributes` 精确增加 V3 `run.json` 的单路径 `-text` 规则，旧三条保持。该原始文件的 13574 字节、一个 CRLF 和 SHA-256 `7da3409bcd3202d03fb56a874f262193f87a700808aa038126d6952e5511bd57` 完整保留；没有改写旧 JSON 或清单。70 项工作树、暂存和提交字节均相符。

[remote-before.json](remote-before.json)、[remote-prepush.json](remote-prepush.json)记录候选/main/PR 复核；有效作者、唯一 push URL 和无活动 hook 见 local-before。[push.json](push.json)记录唯一普通推送，禁止附带 tag；[remote-after.json](remote-after.json)和[remote-final.json](remote-final.json)确认候选更新、main/base 未变。

实际 checkout 取自本次日志的 `git log -1 --format=%H`，再用[Git commit API](checkout-commit.json)核对两个 parents 和相同 tree，没有使用事后 merge ref 替代。

## 实际验证结果

| 检查 | 结果 |
|---|---|
| npm 安装 / 版本一致性 | 通过 |
| 设计门禁 / ESLint | 通过 |
| 全量测试 | 884 通过、0 失败、28 跳过；65 文件通过、3 文件跳过 |
| 构建与 TypeScript | 通过 |
| 双平台配置守卫 / 版本测试 | 28 项 / 39 项全部通过 |
| 安装预览 | 11 项全部通过，整组 18873 ms；默认版本 4940 ms |

Ubuntu 24.04.5，runner image `20260920.314.1`，Node.js `22.23.2`、npm `10.9.8`；x64 由缓存 key 佐证。CI 恢复 npm cache，不构成无缓存或 arm64 分发验收。28 项跳过为语料 23、T1 2、T0 1、Linux 不适用的 Windows PowerShell 2，没有新增跳过。

[test-results.json](test-results.json)是日志摘录汇总，不是 Vitest artifact。预览耗时不等于独立子进程计时，不能由本次默认用例低于旧 5 秒预算推断波动根因已消失。15 秒外层预算、10 秒子进程限制及断言保持。安装的 33 moderate 告警、jose Edge Runtime 警告和 Actions Node 运行时提示保留，本轮未扩大修复。

## 原始证据与后续边界

[ci-log.txt](ci-log.txt)保留 `gh run view --log` 的 73961 原始字节；[log-integrity.json](log-integrity.json)记录哈希，[log-excerpts.json](log-excerpts.json)提供可读摘录。Actions 掩码和控制序列保留，凭据模式未命中，审阅边界见[archive-review.json](archive-review.json)。[artifacts.json](artifacts.json)确认无上传 artifact。

操作前 1124 份既有证据和准备文件见[preservation-before.json](preservation-before.json)，全部原字节保持，见[closeout-checks.json](closeout-checks.json)。旧 V2 失败、V3 881/0/28、RC 本地 67/0/0 和 F 准备附件不回写。新目录哈希见[files.sha256.json](files.sha256.json)，排除自身。

[final-runs.json](final-runs.json)只发现本候选的这次 PR CI，未发现新 Release run；这不代表 Release 成功，真实双架构调度/构建、manifest、GHCR 和匿名安装仍未验证。F 只关闭这次候选提交与完整 PR CI 待验收项。

结果文档与本目录留本地，不自动追加提交或触发第二轮 CI。下一步按具体候选和当前 base 准备 M 的合并/main CI 确认；R 发布另行确认。输入若改变须重新评估证据。规格原 baseline、冻结块和 `in-progress` 保持，不推进 Story/Sprint。
