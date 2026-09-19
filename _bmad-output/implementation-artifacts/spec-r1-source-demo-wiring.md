---
title: 'R1：源码 Demo 接线修复'
type: 'bugfix'
created: '2026-09-14'
status: 'done'
baseline_commit: 'f213761b795cc020be2122e27301fe4a7c5cf7a0'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="用户已确认修复计划、保留工作区与局部验证；多 Agent 仅限本次 R1">

## Intent

**Problem:** `npm run demo` 启动本机 mock，应用却请求容器主机名，源码体验接线失效。

**Approach:** 启动器显式选择本机模式；应用只选择两条固定 mock 地址，默认保持容器模式。

## Boundaries & Constraints

**Always:** 保留现有工作区、数据隔离、Demo 防护、正式配置语义；UTF-8/LF，中文注释。仅局部验证并同步文档。

**Ask First:** 扩大范围，构建、全量测试、容器或重型浏览器验证。

**Never:** 任意模型 URL、依赖升级、数据迁移、改动正式数据、发布；改写历史证据或 Story/Sprint 状态。

## I/O & Edge-Case Matrix

| 场景 | 输入 | 结果 | 失败处理 |
|---|---|---|---|
| 源码 | Demo 开启，运行标记 local | http://127.0.0.1:8787/v1 | 保留启动器报错 |
| 容器 | Demo 开启，标记缺省或非法 | http://mockllm:8787/v1 | 不接受其他目标 |
| 配置污染 | Demo 开启，数据库或环境含外部模型 | 固定 demo/mock，附加模型禁用 | 忽略污染值 |
| 正式 | Demo 关闭 | 数据库优先、环境兜底 | 原行为 |

</frozen-after-approval>

## Code Map

- `scripts/demo.mjs:10`：demoEnv 覆盖宿主环境并传给 Next；探测地址与 mock 均固定 8787。
- `src/lib/llm-config.ts:136`：getLlmConfig 的 Demo 分支在读取数据库前返回。
- `tests/setup.ts`、`tests/helpers/db.ts`：内存数据库与 wipeData；测试不得加载真实环境文件。
- `tests/api/demo-boundary.test.ts`：403、正文限制和客户端地址隐藏回归。
- `docker-compose.demo.yml`、`scripts/mock-llm.mjs`、`docs/adr/0026-demo-ingress-isolation.md`：只读基线；拓扑和 mock 协议不变。
- 历史只读证据 `git show v0.6.0:scripts/demo.mjs`：旧版使用 `{ ...demoEnv, ...process.env }`，确实允许宿主覆盖密码、数据和模型。文档须限定当前候选的强制覆盖语义，并保留固定 v0.6.0 命令的旧版环境说明。

## Tasks & Acceptance

**Execution:**
- [x] `scripts/demo.mjs`、`src/lib/llm-config.ts`：接入 DEMO_RUNTIME=local，缺省或非法值保持固定容器地址。
- [x] `tests/config/demo-launcher.test.ts`、`tests/config/demo-compose.test.ts`、`tests/lib/llm-config.test.ts`、`tests/api/demo-boundary.test.ts`：覆盖表内场景及启动器实际传参，隔离环境与副作用。
- [x] `README.md`、`README.en.md`、`docs/首次使用与故障排查.md`、`tests/docs/first-use-guide.test.ts`：说明当前候选接线，修正密码覆盖的过时说明。
- [x] `CHANGELOG.md`、`docs/releases/v0.6.1.md`、`docs/README.md`、`docs/产品规划/开源发布范围与执行清单-2026-09-13.md`：同步 R1 结果与验证边界。

**Acceptance Criteria:**
- Given 宿主配置有冲突，When 启动源码 Demo，Then 子进程仍收到本机 mock 与独立数据、凭据配置。
- Given 两种 Demo 环境，When 调用高风险入口，Then 仍返回 403 且不产生业务副作用。
- Given 修复完成，When 查阅文档，Then 能区分当前局部结果、历史版本和未完成的运行及发布验收。

## Spec Change Log

## Design Notes

用户已确认上一轮计划，本规格据此落盘，不重复请求授权。R1 不属于新增 Epic/Story。新增标记只选择固定目标，不能恢复 DEMO_LLM_BASE_URL 的任意地址覆盖。保留启动器凭据覆盖宿主环境的现状。审查以实施前 685 文件快照生成的本轮增量为准，不将原有工作区差异归入 R1。

## Verification

- 指定 Vitest：上述测试，加 `tests/config/demo-compose.test.ts`，单 worker。
- 改动 TS/MJS 的定向 ESLint、`node --check scripts/demo.mjs`；必要时定向 TypeScript 检查。
- 文档链接、UTF-8/LF、增量格式与改前快照核对；HEAD 与索引保持。
- 不将模拟子进程测试写成真实启动、浏览器或 Docker 验收。

### 实现阶段结果（2026-09-14）

- 修改实现前，启动器与配置层的 23 项回归出现 3 项预期失败：复用/新启 mock 两条启动路径未覆盖运行标记，以及 `local` 仍返回容器地址；其余 20 项通过。
- 修复后的 5 份指定 Vitest 共 **77/77 通过**；源码与容器各自覆盖 403、请求体边界、客户端地址隐藏和普通笔记入口，高风险路由同时断言不访问数据库、不备份、不写文件、不发网络请求、不消费正文。
- 6 份改动 TS/MJS 的定向 ESLint 与启动器语法检查通过。定向 TypeScript 以改动 TS、`next-env.d.ts`、现有 `src/types/heic-convert.d.ts` 为入口，继承项目配置并关闭 emit/incremental，通过；没有修改依赖或仓库类型配置。
- 13 份实现/测试/文档的 UTF-8/LF、增量格式和代码块通过；新增相对链接核对覆盖 13 处链接、其中 7 处锚点。主 Agent 的 685 文件基线核对为 12 份既有修改、2 份新增、673 份未变；HEAD、索引和冻结块保持。源码修复只增加启动器标记与配置层固定目标选择。
- 双语 README 和首用教程同时保留 v0.6.0 宿主覆盖默认值的历史说明；当前候选的强制覆盖不追溯到旧 tag。Story/Sprint、Compose、mock 协议和历史证据保持。
- 未执行真实服务启动、浏览器、Docker、build、全量测试、模型请求、安装/恢复演练或发布；独立审查由主 Agent 接续。

```powershell
npx --no-install vitest run tests/config/demo-launcher.test.ts tests/lib/llm-config.test.ts tests/api/demo-boundary.test.ts tests/docs/first-use-guide.test.ts tests/config/demo-compose.test.ts --maxWorkers=1
npx --no-install eslint scripts/demo.mjs src/lib/llm-config.ts tests/config/demo-launcher.test.ts tests/lib/llm-config.test.ts tests/api/demo-boundary.test.ts tests/docs/first-use-guide.test.ts
node --check scripts/demo.mjs
```

### 独立审查修正

三路独立审查已完成：边界与验证覆盖未发现阻断；缺项审查结合源码分诊为以下局部修正，接线实现保持。

- [x] `README.md`、`README.en.md`、`docs/首次使用与故障排查.md`、`tests/docs/first-use-guide.test.ts`：旧版 Markdown 缺省写入 `./data/notes`，需显式隔离；限定旧版无外部调用说明，覆盖附加模型环境与已有数据库配置。
- [x] `tests/config/demo-launcher.test.ts`：覆盖 200 响应但身份标记错误、JSON 畸形与实际探测载荷。
- [x] `tests/config/demo-compose.test.ts`：将实际 Compose 的 Demo 环境与模型配置接线核对，阻止误传本机标记。
- [x] `tests/api/demo-boundary.test.ts`：上传/导入使用非空有效请求正文，并断言读取及 clone 入口未调用。
- [x] 本规格：记录可复现的定向 TypeScript 配置、完整入口和命令。

既有探测请求缺少单次时限，已追加至 `deferred-work.md`，不回写旧记录。上述修正复用已通过的配置层及正式模式证据，仅复验受影响的局部检查。

### 定向 TypeScript 复验方法

在仓库根目录使用 PowerShell 执行以下完整命令。临时配置继承仓库 `tsconfig.json`，仅列入本次改动的四个测试入口和已有声明文件；依赖按 TypeScript 正常导入关系检查，不纳入其他测试或生成全仓库输出。配置放在系统临时目录，不修改仓库全局配置，也不写 `tsbuildinfo`。

```powershell
$r1TypeRoot = (Get-Location).Path
$r1TypeConfigPath = Join-Path ([System.IO.Path]::GetTempPath()) ('zhiliao-r1-types-' + [Guid]::NewGuid().ToString('N') + '.json')
$r1TypeEntries = @(
  'next-env.d.ts',
  'src/types/heic-convert.d.ts',
  'tests/config/demo-launcher.test.ts',
  'tests/config/demo-compose.test.ts',
  'tests/api/demo-boundary.test.ts',
  'tests/docs/first-use-guide.test.ts'
)
$r1TypeConfig = @{
  extends = (Join-Path $r1TypeRoot 'tsconfig.json')
  compilerOptions = @{ noEmit = $true; incremental = $false }
  files = @($r1TypeEntries | ForEach-Object { Join-Path $r1TypeRoot $_ })
  include = @()
  exclude = @()
}
[System.IO.File]::WriteAllText($r1TypeConfigPath, ($r1TypeConfig | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
npx --no-install tsc --project $r1TypeConfigPath --pretty false
if ($LASTEXITCODE -ne 0) { throw 'R1 定向类型检查失败。' }
```

上一实现阶段的类型检查入口另含 `src/lib/llm-config.ts` 和 `tests/lib/llm-config.test.ts`，不含当时未修改的 Compose 测试；已有通过记录保留。本次配置层未改，只复用其 18 项测试及正式模式证据。

### 审查修正复验命令

```powershell
npx --no-install vitest run tests/config/demo-launcher.test.ts tests/config/demo-compose.test.ts tests/api/demo-boundary.test.ts tests/docs/first-use-guide.test.ts --maxWorkers=1
npx --no-install eslint tests/config/demo-launcher.test.ts tests/config/demo-compose.test.ts tests/api/demo-boundary.test.ts tests/docs/first-use-guide.test.ts
```

### 审查修正复验结果（2026-09-14）

- 上述四份 Vitest 单 worker **64/64 通过**：启动器 8、实际 Compose 接线 4、两种 Demo 的 API 边界 44、文档 8。配置层本轮未改，复用上一阶段 18 项配置及正式模式回归，不重复执行。
- 四份 TS 的定向 ESLint 通过；直接提取并执行本规格的完整 PowerShell 类型检查命令，通过。3 段 Bash、3 段 PowerShell 同时通过静态语法检查；其中旧版 clone、安装和服务启动示例均未执行。
- 9 份本次修改文件的 UTF-8/LF、新增行格式、代码块及 3 处新增相对链接/锚点通过；冻结块与上一阶段验证记录逐段比较不变。
- 导入按现有接口使用包含笔记的有效 ZIP 原始字节流，上传使用有效 PNG 的非空 multipart。高风险路径同时监控正文方法、`clone` 和流读取入口；403 前不读取正文或执行业务副作用。
- 旧版说明已限定全新目录/专用环境，Bash/PowerShell 显式隔离 `NOTES_EXPORT_DIR` 并清理五组模型环境；已有数据库可覆盖环境值的边界仍明确保留。未改变接线业务代码、Compose、mock 协议、全局配置或已登记的探测超时待办；状态保持 `in-review` 交回主 Agent。

### 最终收尾核对（2026-09-14）

主 Agent 已核对全部审查修正与本轮增量，五项审查待办均完成，无需修改冻结意图或回退实现，`review_loop_iteration` 保持 0。本规格状态置为 `done`，表示本次接线修复、局部验证与文档交付完成。

相对实施前的 685 文件快照，最终为 14 份既有文件修改、2 份新增、671 份哈希不变；没有缺失文件或范围外变化，UTF-8/LF、HEAD、索引、历史记录和冻结块核对通过。源码修复仍只涉及启动器标记与配置层两条固定地址的选择。第一轮 77 项和审查后四份 64 项分别记录，不相加作为一次测试结果。

本次无 `story_key`，按同步规则跳过 Sprint；沿用已确认的工作区与提交边界，不创建提交、推送或发布。真实启动、浏览器闭环、完整门禁及其他工作包验收仍待执行；既有探测单次超时问题仅登记待办。

## Suggested Review Order

**固定 mock 接线**

- 启动器覆盖宿主标记，选择本机 mock。
  [demo.mjs:10](../../scripts/demo.mjs#L10)

- 配置层只选固定目标，保留 Demo 防护。
  [llm-config.ts:136](../../src/lib/llm-config.ts#L136)

**版本与验收边界**

- 旧版命令显式隔离 Markdown 和模型环境。
  [首次使用与故障排查.md:32](../../docs/首次使用与故障排查.md#L32)

- 区分已修复接线与尚未完成的运行验收。
  [开源发布范围与执行清单-2026-09-13.md:151](../../docs/产品规划/开源发布范围与执行清单-2026-09-13.md#L151)

- 候选发布草稿关联修复和剩余验收。
  [v0.6.1.md:19](../../docs/releases/v0.6.1.md#L19)

**回归保护**

- 覆盖配置污染、非法标记与正式模式优先级。
  [llm-config.test.ts:115](../../tests/lib/llm-config.test.ts#L115)

- 验证真实启动脚本传参和 mock 身份探测。
  [demo-launcher.test.ts:91](../../tests/config/demo-launcher.test.ts#L91)

- 从实际 Compose 环境核对容器地址。
  [demo-compose.test.ts:26](../../tests/config/demo-compose.test.ts#L26)

- 非空上传、导入被拒绝前不读取正文。
  [demo-boundary.test.ts:13](../../tests/api/demo-boundary.test.ts#L13)

- 校验双语说明、旧版隔离命令和版本边界。
  [first-use-guide.test.ts:90](../../tests/docs/first-use-guide.test.ts#L90)

## 本机受控源码验收（2026-09-14）

用户先确认隔离方案，再明确允许执行；通过 bmad-checkpoint-preview 单 Agent 完成，记录见 [R1 源码 Demo 接线验收](../../docs/R1源码Demo接线验收-2026-09-14.md)。本节补充实际运行证据，以上实现与局部验证的历史叙述保留原义。

- 使用当前 0.6.1 候选独立副本和复制依赖，实际执行原 npm run demo；应用 3311、mock 8787 均经附加保护限制在回环监听。
- 假宿主配置被启动器覆盖；demo 登录、保存、AI 整理、主题建议、搜索重开均通过。两条验收笔记的数据库正文与唯一 Markdown 副本保持一致。
- 八类受限入口、十二项方法均返回 403，含有效 ZIP 与 PNG；前后 21 张表和 17 个数据文件内容哈希一致。服务端读取正文的细节仍复用已有局部测试，HTTP 观察不替代这一证据。
- 临时数据库保留五组 15 项合成污染配置；重启后仍使用固定本机 mock，附加模型禁用，原 17 条笔记 ID 与会话保留，没有重复播种。
- 运行阶段结束时，原工作区 687 个文件、HEAD、索引及环境/数据保护基线通过。Next 只改动临时副本的两个生成类型文件；业务实现未修改。服务与浏览器已关闭，最终目录清理及文档检查见验收记录。
- Next 开发模式的 npm 版本查询在外连前被附加保护阻断，不能据此声称原启动器天然网络隔离。探测单次超时待办保持，验收采用外部 180 秒启动预算。
- 未运行 build、全量测试、Docker、真实模型、安装/恢复或发布；不推进其他 R1 工作包、Story/Sprint，也不改冻结块和历史证据。
