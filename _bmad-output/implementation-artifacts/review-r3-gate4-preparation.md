# R3 门禁 4：P 阶段串行自审

本次按用户批准范围审阅本地准备，不是独立多 Agent 审查。完整规格保留 `in-progress`，V/R 未执行。

## 审阅范围

- `.github/workflows/release.yml`：tag 触发、权限、原生双架构、缓存、digest 合并、匿名安装、清理和 Release 依赖。
- `scripts/verify-release-gate4.mjs`：候选身份、registry 原始字节、OCI 配置、镜像内探针、资源归属、失败结果和日志。
- `tests/config/release-gate4.test.ts`、既有版本测试及本轮文档：验证覆盖和声明边界。

## 已修正的发现

| 发现 | 处理及保留要求 |
|---|---|
| 增量 Markdown 会将图片 URL 改成 `../assets/`，直接按 API 正文比较将误报 | 按既有 `renderNoteMarkdown` 规则核对完整正文，重建前后仍比较导出文件哈希；不修改产品导出逻辑 |
| 完整 container inspect 含运行凭据，若写入命令日志会污染公开证据 | 容器检查仅输出 labels；镜像检查只选身份字段；探针不输出密码、Cookie 或环境变量 |
| 仅凭预定 data-root 停止 daemon，可能误处理启动前已有目录 | 启动先拒绝已有目录；建立本轮 ownership 输出后才启动，清理步骤受该输出约束，并核对进程命令行 |
| daemon 可能继承 runner 的全局 Docker 配置 | 使用本轮空配置文件、独立 data/exec/socket/pid 路径，不操作默认 daemon，不使用 prune |
| 只列出 manifest 不会阻止架构缺失或 revision 错误 | 对运行平台集合、子 digest、配置架构、完整 revision 和 attestation 归属作硬断言 |
| 运行通过但清理失败可能被误记成功 | 先核对全部资源归属再删除，复查残留；清理失败和 daemon 停止失败均阻断 Release |
| RC 不能移动正式 `latest` 或次版本标签 | 预发布只生成自身完整固定标签；正式版本才生成三个标签 |

## 局部验证

两份配置/版本测试共 61 项通过，0 失败、0 跳过；单测试 worker、文件不并行。目标 ESLint、脚本语法、测试文件的定向 TypeScript 语义检查、YAML 解析、工作流内 Bash/Python 静态语法、版本校验及文档检查另见[准备记录](../../docs/验收证据/r3-gate4-preparation-20260929-a/README.md)。没有为准备阶段运行 Docker、Next build、全量测试或浏览器。

## 仍须真实运行证明

- GitHub 原生 arm runner 的可调度性、实际资源和构建成功。
- Buildx 返回实际 provenance materials；缺少基础镜像 digest 会明确失败，不能用预查询的浮动标签结果填补。
- GHCR 匿名权限、OCI 合并、空 Docker 存储拉取、Linux 原生包及完整安装矩阵。
- 真实 job 取消/超时后的资源与证据结果；静态 `always()` 配置不证明强制中止一定保留全部 artifact。
- 干净 checkout 检查已排除 `next-env.d.ts` 输入；Docker 内实际声明和 Next 构建仍由后续运行生成。本地旧声明不是新候选证据。

这些属于已计划的 V/R 运行范围，不以本地通过替代。P 阶段无剩余已知实现阻断；任何后续源码、依赖、配置或基础镜像变化都须重新核对影响范围。
