# R3 门禁 4：M 合并与 main CI 结果

**M 已完成：PR #12 一次普通合并，自动 main CI 全部通过，884 通过、0 失败、28 项原条件跳过，构建成功。** 用户确认按 [M 执行单](../../R3门禁4合并main与CI执行单-2026-09-30.md)执行；保持单 Agent，未追加提交、推送、rerun 或运行本机重验证，未创建 tag、GHCR 产物或 Release。

**新发现：npm 安装摘要为 33 moderate + 1 high，F 当时为 33 moderate。** main tree 与 F 相同；现有日志仅给出计数，没有指出 high 对应的包、advisory 或变化原因。未追加 `npm audit`、修复依赖或回填旧审计。M 的 CI 成功不代表发布安全审查完成，进入 R 前须定位并复评这一新告警；旧门禁结论继续按原时点解释。

## 提交与执行身份

| 对象 | 实际值 |
|---|---|
| 原 main / B | `6ee67532deed37fda6cc98962e8df76c98659890` |
| 候选 / C | `41cf296d1d1ccc38d1b2f1b3335cc5b8ac4a4b81` |
| F 实际 checkout / P | `4548fe4c1be2f6dcea52501bfd2a559244a68174` |
| main 合并提交 / M | `2ae66f5f3df6b0e7afa3bfa09bf601b18ea96a11` |
| M parents（顺序） | `[B, C]`，恰两个 |
| C/P/M 的相同 tree | `d0f16de6459461315c0b0274a8a0f44bc483e84d` |
| M 作者 | `BAIBAI <BAIBAI2024826@outlook.com>` |
| M 提交者 | `GitHub <noreply@github.com>`，verification=true |
| GitHub 合并操作者 | `B-tech-hub` |
| 合并时间 | UTC `2026-09-29T23:48:50Z`，北京时间 2026-09-30 07:48:50 |
| PR | [#12](https://github.com/B-tech-hub/zhiliao/pull/12)，MERGED |
| CI | [36647162597](https://github.com/B-tech-hub/zhiliao/actions/runs/36647162597)，attempt 1、push、main、success |
| job | `109672690052`，UTC 23:48:57–23:51:03，126 秒 |

整个候选的 28 个提交、704 条路径按批准范围合并。没有 squash/rebase、绕过保护或删除分支。候选远端仍指向 C，结束时 main=M；本地分支/HEAD/refs 未变，暂存区为空，已有结果文档与 F 归档保留。原 main 无保护规则，已按执行单人工核对 F 与实际 main CI。

[merge-attempt.json](merge-attempt.json)、[merge-result.json](merge-result.json)记录唯一请求与 exit 0；[merge-identity.json](merge-identity.json)和[merge-commit.stdout](merge-commit.stdout)保留完整身份、parents、tree 与签名。实际 CI checkout 从日志 `git log -1 --format=%H` 下一行读取为 M，见[checkout-check.json](checkout-check.json)，没有用 API head_sha 替代日志证据。

## 实际检查与边界

| 检查 | 结果 |
|---|---|
| npm ci / 版本一致性 | 成功；安装告警按本页记录 |
| 设计门禁 / ESLint | 成功 |
| 全量测试 | 884 通过、0 失败、28 跳过；65 文件通过、3 文件跳过 |
| 发布配置 / 版本配置测试 | 28 项 / 39 项通过 |
| 安装预览 | 11 项通过，整组 15880 ms；默认版本用例 4649 ms |
| Next build / TypeScript | 成功 |

[test-results.json](test-results.json)摘录真实日志，不是测试报告 artifact。28 项跳过仍为语料 23、T1 2、T0 1 和 Linux 不适用的 Windows PowerShell 2；测试 tree 与 F 相同，未增加 skip 或放宽断言。

Ubuntu 24.04.5，runner image `20260920.314.1`，Node 22.23.2、npm 10.9.8，x64。Node 使用托管工具缓存，npm cache 未找到，结束时保存；Next build cache 未找到。既有 CI 没有输出 CPU/内存/可用磁盘实测数值，未补运行探针，也不声称新增了资源硬配额。详见[环境与警告](environment-and-warnings.json)。这不是 R 的干净独立安装、双架构或受控无缓存证据。

除新增 high 摘要外，jose Edge Runtime、Actions Node 20 转 Node 24 和缓存步骤的 `url.parse()` 弃用提示均保留。没有因这些提示改依赖或工作流；CI 不含独立的 `npm audit` 发布门禁。

## 证据与保留

- [preflight-queries.json](preflight-queries.json)、[preflight-result.json](preflight-result.json)：操作者、仓库/Actions/规则、PR、F 与引用复核；同名 `.stdout/.stderr` 保留查询输出。
- [premerge-pr.stdout](premerge-pr.stdout)、[premerge-refs.stdout](premerge-refs.stdout)：紧邻合并的 C/B 与检查状态；命令只锁定 head 的限制仍按执行单解释。
- [final-run.stdout](final-run.stdout)、[final-jobs.stdout](final-jobs.stdout)：run/attempt、jobs/steps、环境与真实时间；各次 poll 记录原样保留。
- [ci-log.stdout](ci-log.stdout)：完整 71015 字节日志；SHA-256 `43b8283d5dee1ad983a7b4dc0d197ebe0e5a37512bef8f19fcf66b3d2796f4f9`，见[log-integrity.json](log-integrity.json)。[log-excerpts.json](log-excerpts.json)只供阅读，不改原日志。
- [artifacts.stdout](artifacts.stdout)：total_count=0，没有伪造 artifact；[archive-review.json](archive-review.json)与[archive-scan.json](archive-scan.json)记录常见凭据模式未命中及人工摘录审阅边界。
- [final-pr.stdout](final-pr.stdout)、[final-refs.stdout](final-refs.stdout)、[final-runs.stdout](final-runs.stdout)：PR 已合并、main=M、候选=C，M 上只有本次 CI，没有新 Release run；不等于 Release 已通过。
- [preservation-before.json](preservation-before.json)、[closeout-checks.json](closeout-checks.json)：1193 份旧证据及准备文件原字节保持，结果文档同步前本地输入与 refs 未变。
- [final-document-checks.json](final-document-checks.json)：结果文档与旧证据最终静态核对；[files.sha256.json](files.sha256.json)列出本目录全部字节/哈希，排除自身。

全部运行资料先保存在仓库外，再逐字节复制到本目录；原 F、M 准备及更早失败未回写。结果文档仅留本地，不通过新提交改变 M。规格 baseline、冻结块、`in-progress` 与 Story/Sprint 保持，门禁 4–6 未关闭。

下一步先定位新增 high 的具体依赖与适用范围，再决定 R 的执行范围。任何发布源/依赖修正若改变 M，须重新安排候选与 RC，不能沿用旧 tree 的成绩。RC tag、GHCR、原生双架构无缓存构建、manifest、匿名安装及预发布仍未执行、未授权。
