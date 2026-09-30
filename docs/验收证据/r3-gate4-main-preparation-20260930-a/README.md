# M 阶段准备记录（2026-09-30）

**仅只读调查与文档准备，未合并、提交、推送、重验证或发布。** 对应 [M 执行单](../../R3门禁4合并main与CI执行单-2026-09-30.md)。单 Agent，复用 [F 成绩](../r3-gate4-final-061-36585198727/README.md)。

查询时候选 `41cf296d1d1ccc38d1b2f1b3335cc5b8ac4a4b81`、main `6ee67532deed37fda6cc98962e8df76c98659890` 未变；PR #12 为 OPEN、MERGEABLE/CLEAN，F run `36585198727` attempt 1 仍成功。操作者 `B-tech-hub`，仓库允许 merge commit、关闭自动删分支，Actions/CI 已启用。main 无保护、有效规则为空，执行者仍必须核对门禁。

[queries.json](queries.json)记录命令、查询时间与退出码，同名 `.stdout` / `.stderr` 保留实际输出字节；仓库/操作者 API 只保留明确选取的字段，不采集凭据。准备数据不是执行时保证，也没有检查 GHCR 或 R 权限。

| 记录 | 用途 |
|---|---|
| [local-before.json](local-before.json) | 本地 C/tree、分支、空暂存区及原 7 份未提交文档哈希 |
| [refs.stdout](refs.stdout)、[pr.stdout](pr.stdout) | 远端候选/main 与 PR 当前状态 |
| [repository.stdout](repository.stdout)、[operator.stdout](operator.stdout) | 仓库合并配置与 GitHub 操作者 |
| [branch.stdout](branch.stdout)、[rules.stdout](rules.stdout) | main 保护状态与有效规则 |
| [actions.stdout](actions.stdout)、[ci-workflow.stdout](ci-workflow.stdout) | Actions 与 CI 可用状态 |
| [f-run.stdout](f-run.stdout)、[f-runs.stdout](f-runs.stdout) | F 当前状态与同候选全部 Actions 分页结果 |
| [candidate-log.stdout](candidate-log.stdout) | B 到 C 的完整 28 个提交 |
| [candidate-tree.stdout](candidate-tree.stdout) | 完整 C 的 Git 对象清单 |
| [base-to-candidate.stdout](base-to-candidate.stdout) | 704 条路径差异，含 607 条证据/补丁附件 |
| [review.json](review.json) | 范围分组、F 归档核对、预拟合并标题与正文哈希 |
| [merge-body.txt](merge-body.txt) | 供未来获准合并使用的正文，本轮未发送 |
| [preservation-before.json](preservation-before.json) | 1158 份旧证据与准备附件的原字节哈希，含 F 新归档 |
| [document-checks.json](document-checks.json) | 文档静态检查、保留与身份核对结果 |
| [document-inputs.json](document-inputs.json) | 本轮准备完成时执行单与相关本地文档快照，不是提交清单 |
| [files.sha256.json](files.sha256.json) | 本目录最终字节/哈希清单，排除自身 |

旧 F 的 33 项目录清单校验通过；1158 份既有文件保持原字节。原始失败、准备记录与 F 结果均不回填。M 仍待具体确认；本次没有运行测试、lint、build、Docker 或 Actions。
