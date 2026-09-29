# 参与贡献

感谢你对知了感兴趣！Issue、PR、文档改进都欢迎。

## 开发环境

- Node.js ≥ 22

```bash
npm install
cp .env.example .env.local   # 填 APP_PASSWORD / SESSION_SECRET，LLM 三项可先留空
npm run dev
```

当前 0.6.1 候选的 `npm run demo` 已固定本机 mock 接线、演示凭据及 `./data-demo/` 路径，源码受控验收见 [R1 记录](docs/R1源码Demo接线验收-2026-09-14.md)。已发布 v0.6.0 不含这些保护，体验旧版必须遵循 README 的独立目录与环境清理步骤；源码验收不代表镜像已发布。

开始改动前请阅读 [项目开发规范](docs/开发规范.md)；涉及页面、组件、交互或样式时同时阅读 [UI 规范](docs/UI规范.md)。产品边界和新功能冻结仍以 README Roadmap、`CONTEXT.md` 与相关 ADR 为准。

### Windows 注意事项

1. better-sqlite3 与 @node-rs/jieba 均有预编译产物，正常 `npm install` 无需编译器；若安装时报编译错误，安装 Visual Studio Build Tools 后重试。
2. dev 构建目录被占用（句柄锁死）时，可设置 `NEXT_DIST_DIR=.next-verify` 换目录规避。
3. Docker Desktop 的绑定挂载不支持 SQLite WAL，请叠加命名卷配置：`docker compose -f docker-compose.yml -f docker-compose.win.yml up -d`。

## 提交前自检

开发过程中先运行与改动范围匹配的局部测试；准备合并或发布时执行完整门禁：

```bash
npm run check:design
npm run lint
npm test
npm run build
```

完整门禁应在不含正式 `.env*`、数据和旧构建目录的隔离副本执行。`next-env.d.ts` 是工具链生成文件，不作为可复现源码输入；让 Next.js 重新生成并保存结果，避免携带旧隔离目录的类型引用。ESLint 仅排除 `docs/验收证据/` 中按原始字节保存的一次性 `.cjs` 归档，其他脚本继续检查。门禁测试设置 `REQUIRE_DOCKER_COMPOSE=1`，避免把缺少 Compose 的跳过误记为通过；可用 `npm test -- --maxWorkers=1 --no-file-parallelism` 限制并发。

0.6.1 当前源码的四条门禁已于 2026-09-29 通过，输入身份、首轮失败、26 项专项跳过及剩余分发验收见[门禁记录](docs/验收证据/release-gates-061-20260929-a/README.md)。复制本机依赖不构成无缓存安装证据。

修改版本校验或安装冒烟预览时，可先执行局部回归：

```bash
node node_modules/vitest/vitest.mjs run tests/config/release-version.test.ts tests/config/smoke-fresh-install.test.ts --maxWorkers=1 --no-file-parallelism
```

安装预览回归使用 Windows 内置 `powershell.exe`，其他平台使用 `pwsh`（PowerShell 7，须加入 PATH）。本机未安装时该组明确跳过；CI 缺少运行时会失败，不能把跳过记为通过。测试在临时副本中执行原脚本，拦截 Docker 并检查文件树不变，覆盖默认/旧版/RC/digest 和非法镜像参数，不运行真实容器。发布版本测试同时定向检查 TypeScript 调用处的参数类型，不执行 Next 构建或生成增量缓存。

## PR 约定

- 改动较大请先开 Issue 讨论，避免方向不合白做一场。
- 一个 PR 只做一件事。
- 标题使用 `feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:` 前缀。
- 行为变化需在 PR 描述中附验证步骤；UI 改动请附截图。
- 新增或修改代码应符合 [开发规范](docs/开发规范.md)；UI 改动应符合 [UI 规范](docs/UI规范.md)。
- 涉及数据库结构：必须在 `src/db/migrations.ts` **追加**新迁移（禁止修改已发布的迁移），并在 PR 中说明。
- 架构层面的取舍，请在 `docs/adr/` 补一篇决策记录。

## 项目边界

知了定位为**单用户、自托管**的个人知识库。多用户、SaaS、账号体系类需求不在规划内（见 README 的 Roadmap 一节）。

**当前处于新功能冻结状态**：北极星指标是真实笔记数，在它达到 100 条之前不接受新功能。缺陷修复、文档、分发与运维的 PR 照常欢迎。想提新功能请先开 Issue——提案会被记录下来，解冻后统一排期，但此时动手写代码大概率白做。理由见 README 的 [Roadmap](README.md#roadmap)。

## 发布流程（维护者）

1. 以 `package.json` 为应用版本来源，同步 `package-lock.json` 顶层和 `packages[""].version`、主 Compose 与 Demo app/mockllm 的固定镜像。`src/lib/version.ts` 静态导入包版本供 MCP 握手使用，不使用 `npm_package_version` 或运行目录中的包文件。Windows Compose 继承主文件。
2. 候选阶段将 `CHANGELOG.md` 首个版本段写为 `## [未发布] - X.Y.Z 候选`，新增 `docs/releases/vX.Y.Z.md` 草稿；进入 RC 前完成审查、定稿并补正式版本标题/日期，不覆盖旧发布记录。RC 与正式版本共用同一基础版本说明；已发布安装和恢复样例保留其历史版本含义。
3. 执行 `npm run check:design`、`npm run lint`、`npm test`、`npm run build`，全部通过后按已确认范围提交并推送 `main`；运行构建、全量测试及发布仍遵循项目确认规则。
4. 获准后推送预发布标签彩排：`git tag v0.x.y-rc1 && git push origin v0.x.y-rc1`。等待 CI、原生 amd64/arm64 无缓存镜像构建、manifest 严格校验、两平台匿名全新安装及清理、预发布 Release 全部成功。arm64 不可用时保留失败，不改成单架构通过。
5. RC 全绿后，在同一提交上推送正式标签：`git tag v0.x.y && git push origin v0.x.y`。不要在 RC 与正式标签之间夹带未经彩排的提交。
6. Release 工作流会先推送平台 digest、合并 GHCR 标签，再在独立原生 runner 验收安装；全部通过后才创建 GitHub Release。安装失败可能已留下远端镜像或 RC tag，须保留失败记录并人工决定后续，不自动覆盖或删除。发布后确认 `x.y.z`、`x.y` 与 `latest`（正式版本）指向同一多架构 manifest；预发布只生成自身固定标签。
7. 首次发布后需到 GitHub Packages 将包设为 public 并关联仓库（一次性操作）。

版本维护后先执行只读校验：

```bash
npm run check:version
npm run check:version -- --tag v0.6.1-rc1
```

校验覆盖 package/lockfile 根版本、主/Demo/Windows Compose 镜像、Release Notes 标题、CHANGELOG 首个版本段及可选 tag。支持 `vX.Y.Z` 和 `-rc1`、`-rc.1` 形式的 rc/beta/alpha tag；预发布后缀不写入应用基础版本。脚本只核对本地文件，不执行 Git、Docker 或网络操作；通过不代表镜像可获取、安装/恢复已通过或发布获批。

CI 在原四条门禁前增加版本核对。Release 的 `validate` job 使用 Node.js 22 和独立空 npm 缓存执行 `npm ci --ignore-scripts`，核对 `GITHUB_REF_NAME` 后才允许构建。构建使用 `ubuntu-24.04`、`ubuntu-24.04-arm` 原生 runner，两个架构顺序执行；启用 `no-cache`、`pull` 和最大 provenance，不恢复 GHA 构建缓存。记录干净 checkout 的完整提交、文件哈希和生成文件排除项，并从实际构建元数据记录 Node 基础镜像 digest。这里的无缓存指客户端依赖/构建缓存边界，不宣称 registry/CDN 没有缓存。

`scripts/verify-release-gate4.mjs` 负责构建身份、OCI 索引和安装检查。索引必须含两种运行架构，子 digest 与原生构建对应，配置中的 OCI revision 与最终提交相同；attestation 单列。安装任务使用本轮独立空 Docker 存储与空登录配置，匿名按索引 digest 拉取镜像；应用容器无外部网络，通过容器内回环 HTTP 检查健康、登录、真实 PNG 上传、合成笔记、中文搜索、Markdown、容器重建持久化和 MCP 应用版本。SQLite、Jieba 和 Sharp 也在目标平台实际执行。此安装矩阵不验证浏览器交互、外部模型效果、MCP 公网鉴权或异地恢复。

构建 job 上限 60 分钟（构建步骤 45 分钟），安装 job 上限 15 分钟。资源按本轮标签核对归属后清理；专用 daemon 只在本轮成功建立所有权标记后停止，不清理 runner 的默认 Docker 存储。失败、超时或清理失败不能放行 GitHub Release。`gate4-validate`、`gate4-build-*`、`gate4-manifest`、`gate4-install-*` artifact 保留 30 天，构建阶段的 npm/build 日志与耗时另见该次 Actions 日志及 Docker build record。维护者在过期前归档到新的门禁 4 证据目录，不把 artifacts 的存在等同于全部检查通过。

2026-09-29 候选 `321f770` 已推送，PR CI 的版本检查和四条门禁通过（878 项通过、28 项原条件跳过）；当次 Release 因四处 job 级 `env` 使用不支持的 `runner.temp` 而解析失败，零 job 启动，见 [V 运行证据](docs/验收证据/r3-gate4-v-061-36567105695/README.md)。随后已在本地修正：build/install 首个 Bash 步骤通过 `$RUNNER_TEMP` 写入 `$GITHUB_ENV`，后续步骤再消费路径；初始化不创建目录，保留专用 daemon 和匿名配置的不存在检查。上传步骤直接使用合法的 step 级 `runner.temp` 固定目录，避免初始化失败后空变量将上传路径变成根目录。

修改此类路径时，先运行 `release-gate4.test.ts`、`release-version.test.ts` 的串行局部回归，并用理解 Actions 上下文的校验器复核；普通 YAML 解析不能替代。该次使用校验过下载哈希的 `actionlint 1.7.7 -shellcheck= -pyflakes= -no-color .github/workflows/release.yml`，另对初始化片段做 Bash 语法及临时环境验证，见[修复证据](docs/验收证据/r3-gate4-runner-context-20260929-a/README.md)。这是本地验证，尚未提交或推送；新的候选 CI 与 [R 阶段](docs/R3门禁4环境调查与验收计划-2026-09-29.md)另行确认。真实镜像构建、GHCR 取用、双架构安装、RC 和正式发布仍未完成，当前目标 0.6.1 仍未发布。

安装冒烟默认读取脚本所属仓库的包版本。`-PrintConfig` 仅预览；需验证实际 RC 或复用旧版时，用 `-Image ghcr.io/b-tech-hub/zhiliao:0.6.1-rc1` 或明确的固定版本/digest。拒绝 `latest`、`0.6` 等浮动引用；真正运行容器仍按项目验证规则另行安排。
