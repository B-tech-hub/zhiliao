# R3 门禁 4：V 阶段执行结果

**候选推送与 PR CI 通过，但发现 Release 工作流校验阻断。** 用户于 2026-09-29 确认执行 V；按[执行单](../../R3门禁4候选推送与PR-CI执行单-2026-09-29.md)提交 13 个路径，连同原有 8 个提交一次快进推送。PR #12 的版本检查及四条完整门禁成功；另一个 Release 记录在工作流解析时失败，没有启动 job。门禁 4–6、RC 与正式发布仍未完成。

## 提交与运行身份

| 对象 | 实际值 |
|---|---|
| 候选分支 | `candidate/0.6.1-baseline` |
| 新提交 / PR head | `321f770b523773e3f93a56dcf4fd2b1f78213ca5` |
| 父提交 | `549f45200081f9c50b3d658e4c8d1a7c695bde04` |
| main / PR base | `6ee67532deed37fda6cc98962e8df76c98659890` |
| CI 实际 checkout | `4179e0a40ec6d05eedfc0a09dc1517750620b027` |
| 候选与 checkout 的相同 tree | `66ab7b0d7a217f0e8ab9a2dcacbaf969f428389c` |
| PR CI | [36567105695](https://github.com/B-tech-hub/zhiliao/actions/runs/36567105695)，attempt 1，`pull_request`，success |
| job 时间（UTC） | 2026-09-29 12:17:17–12:19:36，139 秒 |

[candidate.json](candidate.json)保存 13 项工作树/Git 字节的 SHA-256，全部一致；[git-tree.txt](git-tree.txt)列出 1672 个 Git 文件对象。checkout SHA 来自[完整日志](ci-log.txt)第 121–122 行，随后以[Git commit API](checkout-commit.json)核对其两个父提交与 tree，没有用运行后的实时 merge ref 回填。推送命令及前后远端状态见 [push.json](push.json)、[remote-before.json](remote-before.json)、[remote-after.json](remote-after.json)和[最终状态](remote-final.json)。只推送候选 ref，未附带 tag。

## PR CI 结果

| 检查 | 结果 |
|---|---|
| `npm ci` | 通过，21 秒 |
| `npm run check:version` | 通过，0.6.1 候选 |
| `npm run check:design` | 通过 |
| `npm run lint` | 通过 |
| `npm test` | 878 通过、0 失败、28 跳过；65 文件通过、3 文件跳过 |
| `npm run build` | 通过，包含 TypeScript 检查和 28 个静态页面生成 |

环境为 GitHub 托管 Ubuntu 24.04.5 LTS，runner image `20260920.314.1`，Node.js `22.23.2`、npm `10.9.8`。x64 由 setup-node 工具路径与缓存 key 佐证；没有额外执行 `uname`。Node 工具缓存命中，npm 缓存恢复未命中，job 结束后保存了 npm 缓存。此结果不能扩大为双架构无缓存镜像验收。

28 个跳过分别是原有语料验收 23 项、T1 2 项、T0 1 项，以及 Linux 不适用的 Windows PowerShell 2 项（`demo-runtime.test.ts:383`、`:393`）。`REQUIRE_DOCKER_COMPOSE=1` 保留，Compose 测试成功。相对 Windows 门禁 3 的 858/26，本次增加门禁 4 配置测试 22 项，并按既有平台条件少运行 2 项，因此为 878/28。没有为了通过而新增跳过条件。

安装日志同时报告 **33 moderate** 依赖告警；这是该次 `npm ci` 输出，不是独立漏洞分诊结果。历史 32 项审计保留其日期与范围，本轮没有升级依赖或执行额外 audit。

## Release 校验阻断

同一次候选推送产生 [Release 36567100870](https://github.com/B-tech-hub/zhiliao/actions/runs/36567100870)，event 为 `push`，attempt 1，立即失败。虽然配置只声明 tag 触发，GitHub 仍为无效工作流生成失败记录；不能据触发过滤器或 PR 检查列表声称不存在 Release 失败。

网页注解报告 `.github/workflows/release.yml` 的 81、206、207、208 行：`Unrecognized named-value: 'runner'`。四处均在 job 级 `env` 使用 `runner.temp`，该位置不支持此上下文。已保存 [run 元数据](release-run.json)、[零 job 结果](release-jobs.json)和[注解提取](release-workflow-error.json)。原网页包含动态会话字段，仅归档可见报错及原网页哈希；不把网页临时字段加入仓库。

这是 P 准备包的工作流缺陷。此前 YAML 解析、Bash/Python 语法及 61 项局部检查未验证 GitHub Actions 表达式上下文，因此没有发现它。本轮 PR CI 成功也不能证明 Release 工作流可执行。失败没有启动 runner job，没有执行该工作流的 Docker、GHCR 或 Release 步骤。

建议的最小修复尚未实施：

1. 将 build 的 `EVIDENCE`，以及 install 的 `EVIDENCE`、`DOCKER_HOST`、`DOCKER_CONFIG` 从 job 级移到前置初始化 step，通过 `$RUNNER_TEMP` 写入 `$GITHUB_ENV`，供后续步骤使用。保留独立目录、空登录配置、资源归属检查及 tag 过滤。
2. 调整已有工作流位置断言，补充上下文限制和初始化顺序回归；检查初始化 step 的 Bash 语法，并用理解 Actions 上下文的校验器复核。普通 YAML 解析不能替代此项。
3. 先局部验证并呈交新差异；下一次提交/候选推送会再次触发完整 CI，须按新范围确认，不能自动重跑本次 run 或修改已推送提交。

## 归档与边界

[summary.json](summary.json)汇总两种结论；[run.json](run.json)、[jobs.json](jobs.json)保留真实步骤与时间。[ci-log.txt](ci-log.txt)为 `gh run view --log` 获取的完整单 job 日志，73443 字节，SHA-256 `05f2eca77755178bdd9de3f45c0bd6da6a145f07c5f9ba588ef295d5eb5c06d1`；保持 Actions 原有脱敏标记和 CLI 输出字节。匹配扫描和人工查看未发现明文凭据或用户数据，扫描能力边界见 [archive-review.json](archive-review.json)。[artifacts.json](artifacts.json)确认本次 CI 没有上传 artifact，不假定存在测试 JSON 或构建下载包。

本轮没有 rerun、取消、合并 main、tag、镜像构建或发布。V 的候选同步、PR CI 和身份归档完成；R 必须先处理上述工作流缺陷，再准备最终发布提交与单独确认单。本目录和状态文档留在本地，未再次提交或推送，不能把它们归入本次已验证提交。
