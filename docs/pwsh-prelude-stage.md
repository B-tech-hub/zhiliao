# 前置分段采集诊断

协议 `prelude-stage-v1`，基线 e 提交 `ac57587e513663f87d60643c45d75a06b06a0e2b`。入口 `scripts/pwsh-prelude-stage.mjs` 独立于原八单元流程，仅运行一次前置预览；不会启动 Vitest、版本探针或业务测试，也不做重复预热。

本地准备仅做离线验证，没有运行真实 pwsh。未来获得专项授权后，命令形式为 `node scripts/pwsh-prelude-stage.mjs --run-prelude <新的仓库外绝对目录> <pwsh绝对路径>`。输出目录已存在时拒绝运行。此标记不代替用户授权；本候选没有新增或修改远端工作流。

## 输入与证据

原 wrapper、目标脚本、两个 package.json 和 arguments.json 共五份 fixture 保持 e 的字节内容。参数、空 PATH、临时目录环境及 10000 毫秒 spawnSync 超时保持。唯一采集开关变化是给 `ZHILIAO_PREVIEW_TRACE_FILE` 指定 fixture 之外、单元目录内的独占文件。目标脚本、原发送钩子和八单元诊断均不修改。

`identity.json` 绑定协议、P1、随机 token、父 PID、采集脚本/wrapper/目标/pwsh 哈希；`invocation.json` 固定命令参数与环境覆盖项，独占 trace 文件通过这些父进程记录绑定身份。子阶段仍用原 `DEBUG-pwsh-20260930` 标识，未向 fixture 写入新的身份字段。

父进程先保存调用前记录，随后最多调用一次原 spawnSync；拿到结果后先确定原退出/超时首因并尝试写 `prelude-process.json`，再写返回记录、解析阶段文件。证据损坏或写入失败成为次生错误，不能覆盖原超时。无调用前证据则不启动子进程。`final-result.json` 是最终结果，`summary.json` 是 fixture 后置检查之前的采集结果；最终文件写入失败时，CLI 输出仍包含首因并非零退出。

`fixture-before.json` 与 `fixture-after.json` 核对五份输入及新增文件，日志在 fixture 外。输出目录的权限与磁盘空间仍是运行前提；若完全无法写盘，只能保留已有文件及 CLI 输出，不能声称证据齐全。

## 判读边界

允许且仅允许四个阶段的连续前缀：wrapper-enter、arguments-read-before、arguments-read-after、target-call-before。校验探针标识、顺序、重复、身份绑定、频率、UTC 和单调计数。正常退出必须有完整四阶段及预期 JSON/stdout、空 stderr，否则失败。

超时且没有阶段只表示未观察到 wrapper 首次写入；部分阶段仅报告最后观察点。target-call-before 不能证明已经进入目标脚本，更不能定位其内部停顿。成功一次也不能说明历史超时已修复。

父进程 duration 使用自己的单调时钟；子阶段 duration 只用同一子进程的 ticks/frequency，不跨进程相减。阶段 I/O 会影响时序，新结果必须独立归档，不与 d/e 拼接。原失败和门禁 4–6 状态保持。

## 本地验收

六类离线场景通过，包括受控进程边界下运行真实入口、五份 fixture 字节核对、空/部分阶段、非法记录以及超时与证据写入失败并存。全部真实 pwsh/Vitest 调用为零。第一次离线验收在验证脚本的 Windows 路径字符串比较处失败，候选代码未改；修正验证脚本后在新目录通过，首次结果保留。
