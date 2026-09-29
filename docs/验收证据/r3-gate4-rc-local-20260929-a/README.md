# R3 门禁 4：RC 前顺序约束与材料定稿的本地验收

**已按用户确认应用六文件补丁，局部检查全部通过：67/0/0，目标 ESLint、actionlint、版本与 RC 版本校验均成功。** 保持单 Agent，未提交、推送、执行完整门禁、运行 Docker、访问远端或发布。真实 R 与门禁 4–6 未完成。

## 输入与实际修改

HEAD 仍为 `b2bae00d4a0e91ef43a0cb41f70f75ebc38ec592`；补丁为[已批准草案](../../patches/r3-gate4-rc-20260929/README.md)，SHA-256 `d64ea633c3f654aa7ed28feab2eb9c398be4ceef006097ff73a12b1825f3c95c`。六文件 before/after 哈希逐一匹配，[application.json](application.json)记录实际应用时间与身份。代码和材料修改未超出补丁，随后只同步结果文档。

- Release 使用 `build_amd64` → `build_arm64` → `merge` → `install_amd64` → `install_arm64` → `release` 成功依赖；版本检查前置，任一前置失败后续阶段跳过。原生 runner、权限、超时、初始化、无缓存、匿名存储、清理和 artifact 名称保持。
- 两份配置测试同步显式 job，覆盖两平台守卫与禁止容错绕过；没有修改产品代码、依赖、验证脚本或原 CI 工作流。
- CHANGELOG 首段及共用 Release Notes 采用 **2026-09-29 材料定稿日期**；不代表正式发布日期。普通安装入口继续固定 v0.6.0，应用基础版本与 MCP 仍为 0.6.1。

## 检查结果

在专用临时目录复制 18 个验证输入，未复制 `.env*`、正式数据、旧构建或生成声明；依赖通过 junction 复用既有 `node_modules`，不安装或升级依赖。此方式不证明无缓存或依赖隔离，工具缓存也可能写入复用依赖目录。18 项文件与工作区哈希一致，检查后输入未改变，见[verification-inputs.json](verification-inputs.json)。

| 命令范围 | 结果 | 耗时 |
|---|---|---:|
| 两份配置测试，单 worker、禁文件并行 | 67 通过、0 失败、0 跳过；gate4 28、version 39 | 4.264 秒 |
| 两份测试的目标 ESLint | exit 0 | 4.541 秒 |
| actionlint 1.7.7，原校验选项 | exit 0 | 0.069 秒 |
| `npm run check:version` | exit 0，0.6.1 | 0.515 秒 |
| `npm run check:version -- --tag v0.6.1-rc1` | exit 0 | 0.374 秒 |

实际命令、UTC 时间、退出码与用时见[checks.json](checks.json)，串行执行器见[run-checks.py](run-checks.py)。两次 npm 命令用既有 Node 执行 npm CLI，未安装工具。测试同时输出[原始日志](tests.log)和[JSON 报告](tests.json)，未注入 observer、未增加重试。Vite 关于未来 native config loader 与 `__dirname` 的提示保留；本轮未扩大配置修复范围。

actionlint 使用此前下载并验证过的本地二进制，SHA-256 为 `6d470a52039a433bccdf57bd65170885a5b23e511155d0de587c2c3ce0eb1c24`，与[旧工具记录](../r3-gate4-runner-context-20260929-a/tool.json)相符。本轮未下载或换版本。每条检查上限 120 秒、总上限 10 分钟，均未触发；没有失败重跑。

## 保留与证据边界

[preservation-before.json](preservation-before.json)记录操作前 1104 份既有证据、补丁附件及旧准备快照；收尾结果见[closeout.json](closeout.json)。旧 V2 失败、V3 的 881/0/28、旧 64 项上下文修复成绩与所有准备附件保持原字节。草案 README 的“未应用”保留历史含义，最新状态以本记录为准。

局部验证临时副本及依赖 junction 保留供复核；未创建业务容器、卷、daemon 或服务，不做默认 Docker 清理。临时夹具位于该副本的独立 temporary 目录；不能把未运行应用解释为通过真实资源清理验收。

完整门禁未重复运行；本次 67 项仅证明所列配置/版本守卫与本地工作流语法，不能代替 GitHub 上的实际调度、镜像构建、GHCR、manifest 或匿名安装。V3 属于原提交，不能覆盖这次工作流变更。规格保持原 baseline、冻结块和 `in-progress`，不推进 Story/Sprint。

当前完整未提交范围见[candidate-inputs.json](candidate-inputs.json)，排除清单自身和本目录最终哈希清单，避免自引用；[files.sha256.json](files.sha256.json)记录本次归档文件哈希并排除自身。清单用于后续最终候选审阅，**不授权提交或推送**；最终候选/main/RC SHA 均未产生。

下一步按[最终候选收口与 RC 执行单](../../R3门禁4最终候选收口与RC执行单-2026-09-29.md)准备 F 的精确输入与自动 PR CI 范围。main、RC tag、GHCR、原生无缓存构建、匿名安装和预发布继续分段确认，不因本地通过而自动开始。
