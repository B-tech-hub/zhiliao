# 0.6.1 候选收口证据（2026-09-23 至 24 日）

状态：准备阶段证据。**没有构建镜像，也没有运行 Docker、浏览器、真实模型或恢复操作。** 范围与判断依据见[收口与 R2 计划](../../0.6.1收口与R2验收计划-2026-09-23.md)，执行步骤见 [R2 操作单](../../R2出口与恢复操作单-2026-09-23.md)，变化组决定见[候选范围核对](../../0.6.1候选范围核对-2026-09-22.md)，对应 [BMAD 规格](../../../_bmad-output/implementation-artifacts/spec-0-6-1-baseline-r2-preparation.md)。

## 1. 候选身份

| 项目 | 值 |
|---|---|
| 输入清单 | [candidate-inputs.json](candidate-inputs.json)：272 个文件，文件 SHA-256 为 `73198e52de5f3b01a8cf7e9c06ef6769a2880d96b206ee2be519c0e0456b316c` |
| 来源 | `6ee67532deed37fda6cc98962e8df76c98659890` 加清单内工作树差异 |
| 范围 | src、public、scripts、tests 与构建/配置文件；不含环境、数据、docs 与 Agent 文件 |
| 本地 tag | `zhiliao-r2:0.6.1-73198e52de5f`，linux/amd64，**未构建**，见 [candidate-identity.json](candidate-identity.json) |

2026-09-23 生成清单后，24 日在所有文档与脚本修改完成后再次逐个重算：272/272 一致，src、public、scripts、tests 下没有清单外文件。本轮只改 docs 与规格，不触碰清单文件，候选身份不变。

对照候选分支提交（2026-09-24）：可提交的 271 个文件中，270 个与提交 blob 字节一致。`tests/config/demo-compose-wrapper.test.ts` 自 `0179c8d` 起工作区为 CRLF、仓库按 LF 保存，去掉 CR 后内容相同，清单记录的是工作区字节。`next-env.d.ts` 被 `.gitignore` 忽略，不在提交中，Next 构建会重新生成。因此 R2 用准备脚本从工作区复制并校验的字节构建，不从全新检出构建；重新检出或归一化该测试文件，准备脚本会按清单拒绝。该文件不进入运行镜像，换行差异不影响运行结果。本目录的身份与命令 JSON 在工作区为 CRLF，提交时已按 `.gitattributes` 归一为 LF，它们不参与清单哈希。

## 2. 局部验证记录

| 验证 | 命令 | 结果 | 时间 |
|---|---|---|---|
| B1 三页回归 | [b1-command.json](b1-command.json) | [b1.json](b1.json)：2 个文件 4/4 通过，无跳过 | 09-23 19:56 |
| R1 最终补丁回归 | [r1-final-patches-command.json](r1-final-patches-command.json) | [r1-final-patches.json](r1-final-patches.json)：5 个文件 94/94 通过 | 09-23 19:57 |
| 定向 ESLint | [targeted-lint-command.json](targeted-lint-command.json) | B1 与 R1 共 12 个文件，退出码 0，无输出 | 09-23 20:24 |
| 版本校验 | [version-command.json](version-command.json) | 退出码 0，输出“版本一致：0.6.1” | 09-23 20:24 |

测试均为单 worker、内存数据库、临时上传/Markdown 目录和 mock fetch，不调用真实模型。同名 `.log` 被仓库忽略，只留在本机，以 JSON 为准。

测试运行后，清单内唯一改动的文件是 19:56:43 的 `tsconfig.json`：它移除隔离类型目录，只影响类型检查范围，不影响 Vitest。被测源码与测试最后修改于 12:33–12:34，所以上述结果对应当前候选内容，本轮没有重跑。

## 3. R1 组合证据

- [T1540](../r1-core-loop-2026-09-22T1540/summary.json)：总状态保持 `failed`，原因是固定拒答句不匹配。记录、三次成功整理、主题、关键词搜索、失败降级和 ZIP 下载仍有效；ZIP 只证明当轮可下载，不证明图片往返或完整恢复。
- [T0114](../r1-core-loop-2026-09-23T0114/summary.json)：`passed`，只覆盖引用与固定拒答；该轮整理失败，不计成功。
- [9 月 15 日安装验收](../../R1安装验收-2026-09-15.md)：无模型保存、搜索、出口与本机安装，保持原依赖与本机范围。
- 两轮真实模型的供应商不同，不能表述为同一供应商、同一镜像的一次全矩阵通过。来源问答预算 10/10 已用完，本轮没有追加调用。

T0114 之后的审查修正（白名单引用不改写、伪造脚注不挡固定句、工具轮过渡句不再拼发、`[^noteId:id]` 兼容）不由运行证据覆盖，而由最终补丁回归覆盖。两次历史运行的 `baseline_commit` 都是 `0179c8d`，不追认当时的完整工作树身份；下表把回归与当前清单哈希对应起来（取前 12 位）。

| 组 | 清单内文件 | 回归 |
|---|---|---|
| B1 | `src/lib/client-note.ts` e3ad987c4d90；inbox `page.tsx` 24c1c39b5f6e；topics/[id] `page.tsx` 7b62db54d643；notes/[id] `page.tsx` 67c0a72425d1；`tests/lib/client-note.test.ts` ef28714bb7c4；`tests/components/client-note-pages.test.tsx` 84144a2b3cd1 | 4/4 与定向 lint；审查见[单 Agent 结论](../../../_bmad-output/implementation-artifacts/review-client-note-closure.md) |
| R1 | `source-refusal.ts` 1b7e8b5ee82e；`chat-context.ts` 9822f00515c6；`chat-stream.ts` ab74ed16f846；`api/chat/route.ts` e7c2112955ad；`api/chat/confirm/route.ts` 96340eb29894；`chat-state.ts` ea6e227ef7d1；测试 source-refusal 762738d7e043、chat-state b92b3e5e06b7、chat-stream 01c79807f810、chat-routes f2a48b16c85f、r1-core-loop-script 8bb56773429d；`scripts/verify-r1-core-loop.mjs` f4df8a05d94c | 94/94 与定向 lint；审查见 [R1 规格](../../../_bmad-output/implementation-artifacts/spec-r1-core-loop.md) |

## 4. R2 准备包

| 文件 | 用途 |
|---|---|
| [r2/prepare-workspace.ps1](r2/prepare-workspace.ps1) | 核对清单后把 272 个文件复制到新目录，生成三份独立 env；不调用 Docker |
| [r2/compose.yml](r2/compose.yml)、[r2/ui.yml](r2/ui.yml) | 离线三实例与恢复实例的临时回环端口 |
| [r2/fixture.cjs](r2/fixture.cjs) | init、seed（含改正文）、seal、export-backup、import-twice、readback、persist、check-persist |
| [r2/inspect.cjs](r2/inspect.cjs) | 只读状态报告：完整性、业务表哈希、图片配对、可导出笔记 |
| [r2/compare.py](r2/compare.py) | snapshot、manifest、zip、restore、unchanged 五种比对 |
| [r2/fixtures/](r2/fixtures/README.md) | 合成 PNG 与真实 HEIC 及其哈希 |
| [sheet-dry-run.ps1](sheet-dry-run.ps1) | 用桩 docker/py 干跑操作单全部命令块；改操作单后先重跑 |

2026-09-24 本地检查，均不调用 Docker、不联网、不调用模型：

- **操作单干跑**：Windows PowerShell 5.1.26100 下 14 个命令块通过。docker 共调用 57 次，其中 compose 为 up 7、exec 15、run 7、stop 7、logs 4、config 4、cp 2、restart 1。所有 up 都带 `-d`，所有 exec 都带 `-T`，健康检查脚本整体透传，每次启动或重启后都先等待就绪；`compare.py` 按 manifest、snapshot、zip、restore×2、snapshot、unchanged 调用 7 次。4 个反例都按预期停止：就绪超时（恰好重试 60 次）、未知角色、证据不覆盖、正式实例变化。修正前的包装函数带参数特性，在同一环境下 6 处 `up -d` 与健康检查行直接报参数错误。另做两个变异（删掉一行就绪等待、把包装函数改回带参数特性），都被试跑脚本判为失败。
- **构建日志写法**：用真实原生进程向 stderr 输出，5.1 下不中断，日志为无 BOM 的 UTF-8，非零退出码可取得。
- **准备脚本试跑**：以 `061-20260924-dryrun` 运行，复制 272 个文件，`compare.py manifest` 通过。三份 env 各 9 个键，端口为 3311–3313，密码与会话密钥均为 64 位且互不相同；重复运行与非法运行标记都被拒绝。试跑目录已删除。
- **compare.py 自测**：合成数据 16 个用例，6 个应通过、10 个应失败，全部符合预期，含 manifest 多一个文件和改一个字节两个反例。
- **容器脚本**：`fixture.cjs`、`inspect.cjs` 通过 `node --check`。容器内上传转换、导出和恢复仍待实测。
- **审查**：单 Agent 审查结论与 7 项补丁见[审查记录](../../../_bmad-output/implementation-artifacts/review-0-6-1-baseline-r2-preparation.md)。补丁之后重跑了操作单干跑和 `inspect.cjs` 语法检查；准备脚本和 `compare.py` 没有改动，沿用补丁前的结果。

## 5. 待提交分组

审查通过后，从 `6ee6753` 新建本地分支 `candidate/0.6.1-baseline`，按下表顺序逐组显式暂存并提交；不推送、不打 tag，以后再快进 main。

| 顺序 | 组 | 文件 |
|---|---|---|
| 1 | 规划与协作资料 | PRD 目录 7 个文件（prd、.memlog、addendum、reconcile-brief、review-editorial、review-rubric、基线期记录）；圆桌第四场 HTML 与记忆；公开语料审查提示词 3 份；`docs/产品规划/README.md` |
| 2 | 工作区清理 | `.gitignore`；`tsconfig.json` 已与 HEAD 一致，`_st.mjs` 已删除，二者无需提交 |
| 3 | B1 审查与三页回归 | `tests/components/client-note-pages.test.tsx`；`review-client-note-closure.md`；`code-review-client-note-*` 3 份（提示词，不是审查结果）；`docs/开发日志.md`；手机快捷记录验收文档 |
| 4 | R1 产品修复 | `src/lib/ai/source-refusal.ts` 与 5 个修改的聊天源码；4 个测试；ADR 0010、0016；`docs/UI规范.md`；`docs/开发规范.md` |
| 5 | R1 验收脚本与证据 | `scripts/verify-r1-core-loop.mjs`；`tests/config/r1-core-loop-script.test.ts`；`spec-r1-core-loop.md`；`code-review-r1-core-loop-*` 4 份；`docs/验收证据/r1-core-loop-*` 10 个目录 |
| 6 | 候选收口与 R2 准备 | 本目录（`.log` 除外）；候选核对表、收口计划、R2 操作单、本规格与审查记录；跨组文件 `CHANGELOG.md`、`docs/README.md`、`docs/releases/v0.6.1.md`、执行清单、`deferred-work.md`、`docs/备份与恢复.md` |

跨组文件同时记录 B1、R1 与候选状态。这里无法交互式按段暂存，因此它们整体放入第 6 组。中间提交可能含有指向后续组的链接，以第 6 组提交后的状态为准。提交前扫描凭据；提交后以 `git status` 确认只剩被忽略文件。

## 6. 未执行与边界

- 固定输入的一次候选构建、R2 三实例实测和恢复实例浏览器检查，均待批准。
- 四条发布门禁、0.6.0→0.6.1 升级与回退彩排、双架构、RC、独立 Linux 和无缓存安装，在 R2 之后另行安排。
- 本目录只证明准备包能走到 Docker 调用之前；R2 通过需要实际运行并逐项比对。同盘演练不记作异地备份。
