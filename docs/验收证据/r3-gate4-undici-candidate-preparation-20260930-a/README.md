# R3 Undici 补丁候选：执行前准备

**仅准备，未暂存、提交、推送、新建 PR、运行新 CI 或发布。** [执行单](../../R3门禁4Undici补丁候选与PR-CI执行单-2026-09-30.md)建议以固定 main M 为父提交建立独立候选，由新 PR 触发一次完整 CI；本轮只读调查、文档和哈希核对。

## 已核对事实

- 本地 C=`41cf296d1d1ccc38d1b2f1b3335cc5b8ac4a4b81`；远端 main M=`2ae66f5f3df6b0e7afa3bfa09bf601b18ea96a11`，tree 均为 `d0f16de6459461315c0b0274a8a0f44bc483e84d`。
- PR #12 已合并，main CI `36647162597` 仍为 success；目标新分支 `candidate/0.6.1-undici-7.29.1` 与同 head PR 均不存在。
- 操作者为 `B-tech-hub`，push 权限为 true；唯一 push URL 为官方仓库。本轮未 fetch、修改 refs 或写远端。
- 准备开始时已有 230 个待提交路径，共 3426562 字节；依赖/代码文件只有 package-lock.json，其余是结果文档与证据。最终加入本次准备材料后的集合以 inputs.json 为准，不能沿用 230 作为最终提交数。
- 初始及最终 Git 过滤核对均无字节转换风险，无须增加 `.gitattributes` 规则；实际提交前仍须验证暂存 blob。

复用[补丁局部证据](../r3-gate4-undici-patch-20260930-a/README.md)：两次审计 0 high，首次 95/1 与定向新旧版本各 2 项通过分别保留。没有重跑审计、测试或 build，约 72 秒超时仍未定因，不在准备阶段修改断言或工具链。

## 文件与输入清单

| 文件 | 说明 |
|---|---|
| `local-before.json`、`preservation-before.json` | 原工作区、Git 身份、refs/index、已有文件指纹与 hook 状态。 |
| `queries.json` 与对应 `.stdout/.stderr` | 7 次只读 Git/GitHub 查询，实际命令、时点和退出码；原始输出保留。 |
| `remote-summary.json` | main/C、M tree、旧 PR/CI、新分支/PR 不存在、操作者和权限摘要。 |
| `pending-before-preparation.json` | 准备前 230 路径的字节、SHA-256、原始/过滤 blob 核对。 |
| `pr-body.md` | 已准备的 PR 正文，不预写新 CI 成功；创建时复制到仓库外并通过 `--body-file` 使用。 |
| `closeout-checks.json` | 旧证据、代码/锁文件、refs/index、规格与当前文档入口的最终静态核对。 |
| `inputs.json` | 本执行单唯一完整候选输入清单，覆盖本次准备及全部待提交文件，排除自身；加自身构成精确暂存集合。 |

inputs.json 同时承担本准备归档的文件哈希索引，不再建立相互引用的第二份 manifest。清单自身在执行时单独计算 SHA-256 并保存在外部执行记录，不把自身哈希写回自身。

原 F/M、high 调查和补丁首次失败目录保持原字节；规格 baseline、冻结块、`in-progress` 和 Story/Sprint 不变。执行本单、新 PR 合并与 main CI、R 三段分开确认；原工作区和 node_modules 保持原状，不自动切换到新候选。
