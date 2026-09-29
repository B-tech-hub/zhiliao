# R3 门禁 4：修复后候选同步准备记录

**本目录只记录审阅与执行准备，不是新一轮运行成绩。** 新的[候选提交、推送及自动 PR CI 执行单](../../R3门禁4修复后候选推送与PR-CI执行单-2026-09-29.md)已形成。本轮保持单 Agent，没有暂存、提交、推送、远端查询、重跑局部/完整检查、Docker、浏览器或发布。

## 身份与范围

- 准备 HEAD：`321f770b523773e3f93a56dcf4fd2b1f78213ca5`，tree：`66ab7b0d7a217f0e8ab9a2dcacbaf969f428389c`，分支 `candidate/0.6.1-baseline`。修复仍是未提交输入。
- 原规格 baseline：`549f45200081f9c50b3d658e4c8d1a7c695bde04`；保持 `in-progress`、原冻结块及未完成的 R。不是 Epic Story，不同步 Sprint。
- 开始时 10 个已跟踪修改、40 个未跟踪证据文件，暂存区为空。本轮仅更新 4 份已有入口文档，新增执行单及本目录 3 个附件文件；最终 54 个实际变化文件。
- 计划提交还包括尚未应用的 `.gitattributes` 三路径保留补丁，合计 55 个路径。不能直接按当前配置暂存三份原始 JSON。
- 远端状态只引用旧 V 的 `remote-final.json`（`2026-09-29T12:23:02.265719+00:00`）；本轮没有把本地 origin 引用或旧归档当成实时查询。

## 串行审阅结论

| 观察方向 | 结论 |
|---|---|
| 修复范围 | 四处 job 级路径移到首步初始化，两处失败上传固定路径；没有业务源码、依赖、Dockerfile、Compose 或 `ci.yml` 改动 |
| 使用顺序与失败路径 | 后续步骤消费 `$GITHUB_ENV`；初始化不提前建目录，匿名空配置/daemon 所有权与清理保持；上传不依赖初始化成功 |
| 验证复用 | 开始时修复输入清单 10/10 匹配、其证据哈希 14/14 匹配、旧 V 证据清单 23/23 匹配；读取最终测试报告为 64/0/0，没有重复运行 |
| 旧 V 与新候选区分 | 旧 CI `36567105695` 的 878/28 和实际 checkout 保持原义；旧 Release `36567100870` 的零 job 失败不抹除，新候选 SHA 尚不存在 |
| CI 观察遗漏 | 旧候选推送已出现无效 Release 失败记录，不能仅查询 PR statusCheckRollup；新执行单增加同候选全部 Actions 记录查询及异常停止条件 |
| 证据入库风险 | 发现下述 3 个 JSON 会受 Git 文本过滤；只准备具体补丁，未修改原始文件或实际属性配置 |

这是同一 Agent 的串行审阅，不是独立多 Agent 评审，也不宣称 Release 已在 GitHub 执行通过。新 CI 的真实结果、`$GITHUB_ENV` 在 runner 的消费和 R 的分发矩阵仍待对应执行。

## 提交前必须保留的原始字节

仓库 `.gitattributes` 当前为 `* text=auto eol=lf`。只读 `git hash-object --no-filters <路径>` 与 `git hash-object --path=<路径> <路径>` 的对象身份对照显示，以下三个文件会被转换；命令未使用 `-w`，没有写对象或暂存区。

共同路径前缀：`docs/验收证据/r3-gate4-runner-context-20260929-a/`。

| 文件 | 字节数 / CRLF 数 | 保留的原始 SHA-256 |
|---|---:|---|
| `bash-init.json` | 1558 / 64 | `77763b2fb7e3bfba2863365d646d00ab2ecd3512fee72e4610cac7d6dd4452ca` |
| `checks.json` | 1920 / 73 | `8e61037068f4694b459368fe053e987a35dc8c3d5e7a0d13a17e14963453c4c1` |
| `tool.json` | 423 / 8 | `3e72595f46307e7db340599144ac26dd6b3034ffc1bc0d796f8e7b75b9707847` |

统一 LF 与保留已有证据字节在这三处冲突。按本轮用户明确的“保留旧证据”，建议采用 [preserve-evidence.patch](preserve-evidence.patch)：只追加三条精确 `-text` 属性及中文注释，不设目录或全局例外。补丁未应用，应用和暂存字节核对属于后续执行单范围；当前不能声称已消除 Git 入库风险。

## 清单与保留结果

[inputs.json](inputs.json)记录本轮审阅输入、最终准备路径/哈希和拟修改 `.gitattributes` 的前后哈希：

- `files`：53 个实际文件，排除清单自身以避免自引用。
- `manifest_path`：清单自身；执行时在仓库外记录其哈希，加入暂存集合。
- `proposed_files`：1 个尚未应用的 `.gitattributes`，不得把目标哈希称为当前文件哈希。
- `reused_evidence`：历史局部结果及核对边界；没有新测试成绩。
- `preservation`：准备开始时 1011 个既有证据文件、原 HEAD、暂存区、规格 baseline 和冻结块的保留结论。

本轮结束时既有证据保持原字节，`.github/workflows/release.yml`、两份配置测试、验收工具、`ci.yml`、package/lockfile 及真实 `.gitattributes` 未再改动。入口文档使用 UTF-8/LF；未重跑 actionlint、Bash 对照、ESLint、版本门禁、Vitest 或 build。文件读取、哈希对照和文档自审只用于准备，不构成应用或 CI 重验证。

BMad 渲染命令仅执行一次，成功后读取渲染工作流；其中的子 Agent、后续实现及完成全规格要求按用户“单 Agent、仅准备”的明确范围收窄。没有将本轮准备解释为 R 授权，旧执行单与归档仍保留历史含义。
