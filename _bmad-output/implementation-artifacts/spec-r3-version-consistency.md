---
title: 'R3：0.6.1 版本一致'
type: 'chore'
created: '2026-09-13'
status: 'done'
baseline_commit: 'f213761b795cc020be2122e27301fe4a7c5cf7a0'
review_loop_iteration: 0
context:
  - '{project-root}/docs/产品规划/开源发布范围与执行清单-2026-09-13.md'
---

<frozen-after-approval reason="用户已批准 R3 实施计划与 0.6.1 目标">

## Intent

**Problem:** 包版本为 0.6.0，MCP 握手写死 0.5.0，分发入口缺少一致性校验。

**Approach:** 以 package.json 为唯一应用版本来源，统一为 0.6.1；固定分发配置并在发布构建前校验，明确候选与已发布版本。

## Boundaries & Constraints

**Always:** 单 Agent，保留工作区；UTF-8/LF、简体中文注释。保留产品边界、100 条冻结、原四条发布门禁、RC 与正式 tag 同提交、Story 2.2 全部原验收。

**Ask First:** 扩大实现或验证范围。

**Never:** build、全量测试、容器演练、提交/推送/tag/发布；修改既有 Story/Sprint 完成状态、历史证据或依赖版本。源码 Demo 接线冲突保留为独立候选阻断；MCP 鉴权与工具语义另行分诊。

## I/O & Edge-Case Matrix

| 场景 | 输入 | 结果 | 失败处理 |
|---|---|---|---|
| MCP | initialize | serverInfo.version = 包版本，协议不变 | 沿用原响应 |
| 安装预览 | 默认或明确固定 tag/digest | 解析镜像，不调用 Docker | 非固定引用拒绝 |
| 发布核对 | 正式/RC tag | 基础版本匹配包、锁文件、Compose、发布材料 | 漂移或缺文件非零退出 |

</frozen-after-approval>

## Code Map

- `src/app/api/mcp/route.ts`：仅替换握手版本；ADR-0019 的鉴权/工具偏差不在本轮修复。
- `package.json`、`package-lock.json`：仅根版本与校验命令；`tsconfig.json` 已支持静态 JSON 导入。
- `docker-compose.yml`、`docker-compose.demo.yml`：固定应用镜像；Windows 继承主文件，Nginx 摘要与隔离配置保持。
- `scripts/smoke-fresh-install.ps1`：已有隔离安装冒烟，读取脚本所属仓库版本。
- `.github/workflows/ci.yml`、`.github/workflows/release.yml`：保留门禁与双架构构建，在推送镜像前增加版本核对。
- `README.md`、`README.en.md`、`docs/README.md`：入口索引；历史 0.6.0 安装命令与恢复示例保持其版本含义。

## Tasks & Acceptance

**Execution:**
- [x] `package.json`、`package-lock.json`、`src/lib/version.ts`、`src/app/api/mcp/route.ts`：统一 0.6.1 静态版本。
- [x] `docker-compose.yml`、`docker-compose.demo.yml`：应用与 mock 固定 0.6.1。
- [x] `scripts/smoke-fresh-install.ps1`：默认读包版本，支持固定镜像覆盖与无副作用预览。
- [x] `scripts/check-release-version.mjs`、`.github/workflows/ci.yml`、`.github/workflows/release.yml`：只读校验及 CI 接线。
- [x] `tests/api/mcp.test.ts`、`tests/config/release-version.test.ts`：覆盖表内场景、版本漂移和非法 tag；`tests/docs/first-use-guide.test.ts` 将候选镜像断言关联包版本，保留历史教程验收。
- [x] `CHANGELOG.md`、`docs/releases/v0.6.1.md`、`CONTRIBUTING.md`：候选说明与发布步骤。
- [x] `README.md`、`README.en.md`、`docs/README.md`、`docs/首次使用与故障排查.md`、`docs/部署手册-tailscale.md`、`docs/adr/0026-demo-ingress-isolation.md`、`docs/产品规划/知了开发实施方案-v1.0.md`、`docs/产品规划/开源发布范围与执行清单-2026-09-13.md`：同步当前事实与独立待办。

**Acceptance Criteria:**
- Given 包版本变化，When 初始化 MCP，Then 返回同一版本且不依赖运行目录或环境版本变量。
- Given 锁文件、分发镜像或发布材料漂移，When 核对版本，Then 失败且不构建或发布。
- Given 当前候选尚未发布，When 阅读安装与验收说明，Then 可区分 0.6.0 历史结果、0.6.1 局部结果与待验收项。

## Spec Change Log

## Design Notes

2026-09-13 用户已批准实施与局部验证，沿用现有脏工作区，不重复请求批准。R3 是独立工作包，不绑定 Epic/Story；工作流的多 Agent、状态同步及重验证要求以本次明确限制为准。静态 JSON 导入避免 standalone 运行时读取裁剪后的 package.json；镜像固定值由校验器约束。0.6.1 的镜像 digest 与最终提交在后续发布准备中确定。

## Verification

- 指定运行上述两份 Vitest，加既有 `tests/config/demo-compose.test.ts`、`tests/docs/first-use-guide.test.ts`；单 worker。
- `npm run check:version`，匹配正式/RC tag 及错误 tag 的退出码。
- 对本轮 TS/MJS 执行定向 ESLint；PowerShell AST 与 `-PrintConfig` 参数检查。
- YAML 静态解析、`git diff --check`、改前快照核对；不启动 Docker，不改既有证据。

**执行记录（2026-09-13）：**

- `node node_modules/vitest/vitest.mjs run tests/api/mcp.test.ts tests/config/release-version.test.ts tests/config/demo-compose.test.ts tests/docs/first-use-guide.test.ts --maxWorkers=1 --no-file-parallelism`：4 文件、51 项通过（MCP 4、发布版本 38、Demo 配置 3、文档 6）。
- 本轮 6 份 TS/MJS 的定向 ESLint 通过；版本 CLI 的默认、正式 tag 和 RC tag 通过，错误 tag 与缺参数返回 1。仅检查本地文件，未运行 CI 或 Release 工作流。
- PowerShell AST 通过；11 个预览用例覆盖默认/旧版/RC/点分 RC/digest、浮动版本、错误仓库/摘要/RC、末尾换行。用例从仓库外运行，移空 Docker 搜索路径并注入错误环境版本，结果符合预期，未创建冒烟资源。
- I/O 表三行均有已执行证据；未运行 build、全量测试或容器演练。standalone 与实际镜像握手仍属于后续发布验证。
- 25 份本轮文件的 UTF-8/LF、12 份文档的代码块及 25 个新增相对链接通过检查，含 5 处标题/显式锚点和 8 处代码行锚点；`git diff --check` 通过。

**审查与保留：** 按用户单 Agent 要求串行自审缺项、边界及验证覆盖，未运行独立审查 Agent。以执行前文件快照界定 R3 增量，不将已有 WIP 差异作为本轮新增。19 份既有文件按范围修改、新增 6 份，其余 659 份哈希不变；HEAD 与索引不变。包依赖与 lockfile 依赖项、Compose 拓扑、MCP 非版本逻辑、README Roadmap 和旧 CHANGELOG 逐项核对保持，PowerShell 原 UTF-8 BOM 保留。

源码 Demo 接线与 MCP 其余契约问题已按用户范围留在执行清单，不在本轮修复；无新增的 R3 实现阻断。R3 完成仅表示本规格范围的实现和局部验证完成，不表示发布或 Story 2.2 完成。

## Suggested Review Order

**版本来源与运行时**

- 从唯一版本入口看静态打包方式。
  [version.ts:1](../../src/lib/version.ts#L1)
- 握手仅替换版本，保留协议与工具逻辑。
  [route.ts:12](../../src/app/api/mcp/route.ts#L12)

**分发与发布边界**

- 版本漂移和无效 tag 在发布构建前失败。
  [check-release-version.mjs:15](../../scripts/check-release-version.mjs#L15)
- 核对默认镜像、固定覆盖和无副作用预览。
  [smoke-fresh-install.ps1:11](../../scripts/smoke-fresh-install.ps1#L11)
- 区分候选实现、历史证据与发布待办。
  [v0.6.1.md:1](../../docs/releases/v0.6.1.md#L1)

**接线与回归证据**

- 原双架构构建等待版本校验。
  [release.yml:17](../../.github/workflows/release.yml#L17)
- 通过真实 CLI、夹具与工作区文件覆盖成功和失败。
  [release-version.test.ts:15](../../tests/config/release-version.test.ts#L15)
- 实际调用路由，核对版本与协议外壳。
  [mcp.test.ts:16](../../tests/api/mcp.test.ts#L16)

## 复审修正（2026-09-13）

用户在单 Agent 只读审查后批准落实两项发现。本轮沿用本规格与已有工作区，仅修正校验器类型和预览回归；冻结块、既有执行记录、元数据以及 Story/Sprint 状态保持。

- `scripts/check-release-version.mjs`：为导出参数声明可选的 `root`、`tag`，修复 TypeScript 调用处两项 `TS2353`，不改变运行行为。
- `tests/config/release-version.test.ts`：定向检查真实 TypeScript 调用文件，避免仅靠 Vitest 转译而漏过参数类型错误；不生成构建产物。
- `tests/config/smoke-fresh-install.test.ts`：将已有 11 类预览场景固化为回归。在临时仓库副本、独立工作目录和临时目录中执行原 PowerShell 脚本，检查 JSON、退出码、零 Docker 调用及文件树不变。测试阻断真实 Docker；本机缺少 PowerShell 时明确跳过，CI 缺少时失败。
- `CONTRIBUTING.md`：补充局部命令、PowerShell 前提和验证边界。

验收：Given TypeScript 调用传入可选 `tag`，When 进行定向类型检查，Then 不再出现 `TS2353`；Given 默认镜像、固定版本或非法镜像，When 执行预览回归，Then 输出与退出码符合原契约，且不调用 Docker、不创建冒烟资源或改写输入文件。

局部验证安排：单 worker 运行发布版本与安装预览两份测试，定向 ESLint、格式及改前快照核对。MCP、Demo 拓扑与历史文档测试复用原记录；不执行 build、全量测试、容器演练或发布。

**执行结果：**

- 新增类型回归先单独运行，准确复现两项 `TS2353`；补充参数 JSDoc 后转绿。该检查使用真实调用文件，不通过关闭类型规则或修改错误期望放行。
- `node node_modules/vitest/vitest.mjs run tests/config/release-version.test.ts tests/config/smoke-fresh-install.test.ts --maxWorkers=1 --no-file-parallelism`：2 文件、50 项通过，含发布版本 39 项、安装预览 11 项，无跳过。本次实际使用 Windows PowerShell；未运行远端 CI 或其他平台运行时。
- 三份本轮 TS/MJS 的定向 ESLint 通过；新增预览测试文件的定向 TypeScript 检查为 0 项诊断。测试没有调用真实 Docker，预览夹具的文件树均保持不变。
- 单 Agent 串行自审未发现新增阻断。只修改 4 份原有文件并新增 1 份测试，其余 680 份文件哈希不变；HEAD、索引、原冻结块与元数据、Story/Sprint、原 PowerShell 脚本及历史 JSON 保留。

这些结果补齐本次两项复审发现，不扩展为完整构建、容器、安装/恢复或发布验收。原 51 项验证记录保持其历史范围，不与本次 50 项相加宣称新的全量结果。

### 本次修正审阅顺序

- 核对预览隔离、Docker 拦截和文件树断言。
  [smoke-fresh-install.test.ts:78](../../tests/config/smoke-fresh-install.test.ts#L78)
- 核对可选参数类型声明及真实调用回归。
  [check-release-version.mjs:13](../../scripts/check-release-version.mjs#L13)
  [release-version.test.ts:119](../../tests/config/release-version.test.ts#L119)
- 核对运行前提、局部命令与 CI 缺少 PowerShell 时的处理。
  [CONTRIBUTING.md:36](../../CONTRIBUTING.md#L36)
