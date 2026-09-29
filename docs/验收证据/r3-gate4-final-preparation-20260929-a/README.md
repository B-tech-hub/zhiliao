# R3 门禁 4：最终候选 F 准备记录

状态：**仅准备，等待 F 执行授权**。用户在六文件本地补丁通过后要求继续，本轮串行审阅未提交差异，准备[最终候选提交与 PR CI 执行单](../../R3门禁4最终候选提交与PR-CI执行单-2026-09-29.md)，没有暂存、提交、推送或重验证。

[local-remote.json](local-remote.json)记录只读查询：HEAD/远端候选/PR head 均为 `b2bae00d4a0e91ef43a0cb41f70f75ebc38ec592`，main/base 为 `6ee67532deed37fda6cc98962e8df76c98659890`；PR #12 OPEN、非草稿、MERGEABLE。当前 GitHub 账号 `B-tech-hub` 有仓库 push 权限；Git author/committer 为 `BAIBAI <BAIBAI2024826@outlook.com>`。唯一 origin 推送地址符合预期，未发现活动 hook 或 mirror。执行前仍须实时复核。

复用[本地 67/0/0 与静态校验](../r3-gate4-rc-local-20260929-a/README.md)，18 个验证输入与批准补丁的六文件结果保持。V3 的完整 CI 属于旧 HEAD，本次新工作流尚未获得远端 CI 证据。未重复测试、build、Docker 或 actionlint；未改业务、依赖、工作流或测试。

[review.json](review.json)记录本轮差异/输入/证据保留与 Git 内容过滤检查，旧 1120 份证据和准备附件保持。发现 V3 `run.json` 的一个 CRLF 会被暂存转换；已提供 `.gitattributes` 单路径 `-text` 规则方案并在隔离属性目录对照，真实属性文件与旧证据未改。其他当前路径未发现转换差异；历史清单不回写。

[inputs.json](inputs.json)列出 68 项当前路径/字节/SHA-256，另列 `.gitattributes` 拟修改项及清单自身，组成唯一 **70 路径**待提交集合。必须先按方案保护原始字节，才允许后续暂存。它是审阅输入，不是提交授权；不得再沿用上轮 64 路径或 V3 的 61 路径。

拟执行 F 仅包含一次候选提交、一次普通推送、自动完整 PR CI、必要的定向取消及本地归档。排队 30 分钟、运行 60 分钟为人工停止上限；不 rerun、不合并 main、不打 tag、不触发 GHCR/Release。旧失败和原规格 baseline、冻结块、`in-progress` 及 Story/Sprint 保持。
