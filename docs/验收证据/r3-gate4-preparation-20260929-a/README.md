# R3 门禁 4：P 阶段本地准备

**结论：本地准备完成，远端与发布验收尚未运行。** 用户批准范围为发布工作流、验收脚本、相关文档及局部检查。本记录不关闭门禁 4–6。

## 身份与变更

- 执行基线：`549f45200081f9c50b3d658e4c8d1a7c695bde04`，沿用 `candidate/0.6.1-baseline`；本轮未提交或推送。
- 修改 `.github/workflows/release.yml`：顺序执行原生 amd64/arm64 无缓存构建、实际 provenance、严格 OCI 校验、独立匿名安装与清理；GitHub Release 等待安装成功。
- 新增 `scripts/verify-release-gate4.mjs`、`tests/config/release-gate4.test.ts`，同步 CONTRIBUTING、计划、规格及文档索引。
- 本地文件身份见 [inputs.json](inputs.json)。该表是准备文件及相关只读输入的快照，不是完整候选构建清单；后续运行须绑定新的完整 Git 提交和构建身份。
- 门禁 3 及既有 R1/R2、TipTap、升级回退证据原样保留；应用源码、依赖、Dockerfile、Compose、原 CI 工作流和正式数据不改。

## 已运行检查

| 检查 | 结果与边界 |
|---|---|
| `release-gate4.test.ts` + `release-version.test.ts` | 2 文件、61 项通过，0 失败、0 跳过；单 worker、不并行测试文件，见 [test-results.json](test-results.json) |
| 目标 ESLint / `node --check` | 只检查新增工具与测试，不跑全仓 lint 或构建 |
| 定向 TypeScript 语义检查 | 检查新增测试的真实导入调用，不写增量缓存 |
| YAML、Bash、Python 语法 | 解析发布工作流，10 个 shell 步骤做 `bash -n`，内嵌 Python 仅做 AST 解析，不执行其中的运行命令 |
| 版本与文档 | RC 版本只读校验、UTF-8/LF、相对链接及 diff 空白检查 |

检查汇总与命令结果见 [checks.json](checks.json)。首轮 61 项已通过；自审随后补充 daemon 空配置和 ownership 检查，对应定向复验仍为 61 项通过。测试保留既有 Vite `__dirname` 兼容提示，未因此修改测试配置。

## 运行链与证据边界

当前工具的 `preflight`、`record-build`、`merge`、`install` 为四个阶段：前两者绑定构建输入与真实产物，`merge` 会推送镜像标签，`install` 会从 GHCR 拉取并运行容器。只有 `--help` 可作为无副作用帮助入口；实际执行入口要求 GitHub Actions 环境。当前没有执行这四个阶段。

安装任务采用独立空 Docker daemon 和空登录配置，镜像使用固定索引 digest。应用容器设置 `--network none`，通过 `docker exec` 中的回环 HTTP 完成健康、登录、PNG 上传、笔记、中文检索、MCP 版本和重建持久化；不对宿主发布端口，不验证浏览器、真实模型或公网入口。失败证据仅保存合成实例信息；容器 Env 和会话 Cookie 不进入 artifact。

工作流必须先写入 GHCR 才能验证匿名取用；安装失败仍可能留下已发布的 digest/RC tag，不能因 GitHub Release 未创建就声称没有外部写入。现有 `main`/PR CI 保留原四条门禁；未来推送候选会触发它，须单独确认重验证。

## 自审与下一步

[串行自审](../../../_bmad-output/implementation-artifacts/review-r3-gate4-preparation.md)记录修正项和真实运行缺口。当前仅完成 P，规格仍为 `in-progress`；后续按[分阶段计划](../../R3门禁4环境调查与验收计划-2026-09-29.md)审阅待提交内容，确认 V 的候选推送/CI，再单独确认 R 的 tag、GHCR 和 Release。正式发布、异地恢复和 Story/Sprint 状态不变。
