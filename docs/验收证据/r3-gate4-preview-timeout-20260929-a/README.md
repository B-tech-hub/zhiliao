# R3 门禁 4：安装预览测试预算局部修复

**局部修复已完成，本机 11 项定向测试与目标 ESLint 通过；尚未提交或推送，原 V2 CI 失败保持。** 用户同意处理安装预览测试的局部超时预算和定向验证。本轮保持单 Agent，只修改测试预算、同步相关文档并新增本目录；没有运行全量测试、build、新远端 CI 或发布。

## 输入与修复

本轮 HEAD 为 `82b1e5a1b98d4b687d8604a84c47c8ec416bf818`，分支为 `candidate/0.6.1-baseline`。修复留在未暂存工作树中；[inputs.json](inputs.json)记录文件输入哈希及本机结果，不将 HEAD 本身记为已包含修复。

[原 V2 失败](../r3-gate4-v2-061-36574616627/README.md)是本次修改的直接依据：CI `36574616627` 中默认包版本用例耗时 5244 ms，超过外层默认 5000 ms；其 PowerShell 子进程上限为 10000 ms。原 CI 为 880 项通过、1 项失败、28 项跳过，build 未执行。旧运行中同一用例曾以 2106 ms 通过，但 Linux 耗时波动的具体原因尚未证实；本轮没有重复运行失败版本。

[`tests/config/smoke-fresh-install.test.ts`](../../../tests/config/smoke-fresh-install.test.ts)只新增 `previewTestTimeoutMs = 15_000`，并传给两组 `it.each`，共覆盖 5 个正向、6 个拒绝用例。外层预算包含进程执行及快照、断言开销；子进程 `timeout: 10_000`、所有参数、输出、退出状态、Docker 拦截与目录快照断言保留。未修改全局 Vitest 配置、预览脚本、工作流、依赖、重试或跳过条件。[test-change.patch](test-change.patch)保存实际差异。

## 已执行的局部验证

运行时间记录见 [checks.json](checks.json)。只执行一次下列定向测试和一次目标 ESLint，测试使用一个 worker 并关闭文件并行：

```text
node node_modules/vitest/vitest.mjs run tests/config/smoke-fresh-install.test.ts --maxWorkers=1 --no-file-parallelism --reporter=json --outputFile=<本轮临时目录>/tests-after.json
node node_modules/eslint/bin/eslint.js tests/config/smoke-fresh-install.test.ts
```

| 检查 | 实际结果 |
|---|---|
| 定向测试 | 11 通过、0 失败、0 跳过；命令耗时约 4.969 秒 |
| 目标 ESLint | exit 0；命令耗时约 2.469 秒，无输出 |
| PowerShell 子进程 | 11 次；5 次 status 0、6 次 status 1，均无 signal 或 error_code |
| 子进程计时 | 约 322.884–397.943 ms；默认包版本约 389.241 ms；全部进程上限仍为 10000 ms |

[tests-after.json](tests-after.json)为 Vitest 原始报告；[tests-output.txt](tests-output.txt)与 [eslint-output.txt](eslint-output.txt)按各命令 stdout 后接 stderr 保存，非交错时序日志。Vite 关于未来 native loader 不支持 `__dirname` 的现有警告原样保留，没有修改配置或抑制警告。

本次测试进程通过临时 `NODE_OPTIONS --require` 加载 [observe-preview.cjs](observe-preview.cjs)，包装 `spawnSync` 并同步内建 ESM 导出，仅记录执行 `preview.ps1` 时的元数据，返回原调用结果。记录写入仓库外临时目录，不进入测试 fixture，不记录 stdout、stderr 或环境变量。[preview-processes.jsonl](preview-processes.jsonl)保存每次状态与耗时；计时还包含读取参数 JSON 的少量开销，不能视为精确的 PowerShell 内部耗时。

这些是 Windows `powershell.exe` 本机结果，不能证明 Linux CI 原超时已复现或消失。若后续获准复用 observer，应先复制到新的临时目录，让 JSONL 写入新位置，禁止直接从本归档加载并覆盖、追加旧记录。

## 保留核对与后续边界

[before.json](before.json)保存修改前 1752 个文件及其中 1050 份旧证据的哈希，包含前轮尚未提交的结果文档和 V2 归档。[preservation.json](preservation.json)记录本次收尾核对：旧文件无丢失，1050 份旧证据字节全部保留，本轮仅测试文件与 8 份文档发生已有文件变化；移除新增常量和两处超时参数后，测试与修改前字节一致。HEAD、Git index、空暂存区、规格 baseline 和冻结块保持。原规格 baseline 仍为 `549f45200081f9c50b3d658e4c8d1a7c695bde04`，状态仍为 `in-progress`。

原始结果从临时目录按字节复制；[files.sha256.json](files.sha256.json)列出本归档文件哈希，排除清单自身。源码与同步文档为 UTF-8/LF，新增中文注释可按 GB2312 编码；收尾只核对文件、链接和记录，没有重跑测试。

本轮局部授权已完成。新候选提交、推送及完整 CI 仍需按新增差异安排，不能重复执行已用过的 V2 55 路径方案。旧 V2 失败不回填为成功，门禁 4–6 未关闭，不推进 Story/Sprint，也未执行 R、tag、GHCR 或 Release。
