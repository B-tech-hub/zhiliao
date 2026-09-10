---
title: 'Story 1-1 固化受支持的 GitHub 安装路径'
type: 'feature'
created: '2026-09-09'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'ab5b4b2c27e57d8f2a8cdf08a9310725f6f603b9'
context:
  - 'D:/ClaudeProjects/ai_acknowladge/_bmad-output/implementation-artifacts/epic-1-context.md'
  - 'D:/ClaudeProjects/ai_acknowladge/README.md'
  - 'D:/ClaudeProjects/ai_acknowladge/README.en.md'
  - 'D:/ClaudeProjects/ai_acknowladge/docs/部署手册-tailscale.md'

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** 当前 Docker compose 使用 `latest`，README 的源码克隆和配置文件下载使用 `main`，新用户无法从一个明确、已验证的 GitHub 基线复现安装；中英文安装路径也没有明确主次关系。

**Approach:** 将 Docker 预构建镜像设为主路径，将 v0.6.0 tag 的源码安装设为备用路径，并在中英文 README、正式 compose 与演示 compose 中统一固定版本。补齐 Node.js、Docker、持久化目录、必填环境变量、端口、Windows WAL 命名卷和 Tailscale HTTPS 前置说明。

## Boundaries & Constraints

**Always:** 保持现有 Docker/Node 长驻架构和目录约定；正式 Docker 镜像使用 `ghcr.io/b-tech-hub/zhiliao:0.6.0`；源码和 Raw 文件下载使用 `v0.6.0` tag；`APP_PASSWORD` 与 `SESSION_SECRET` 必须明确为必填；文档说明正式数据、演示数据和测试数据隔离。

**Ask First:** 若发现 v0.6.0 tag、GHCR 镜像或现有 compose 约定与仓库当前事实不一致，暂停并请求确认，不自行改写发布基线。

**Never:** 不新增安装器；不改运行时架构；不承诺 serverless；不使用 `latest` 或 `main` 作为受支持安装路径；不要求真实 API Key、正式数据或正式卷完成安装验证。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Docker 主路径 | 全新目录、Docker Compose、v0.6.0 compose 文件 | 使用固定 0.6.0 镜像启动，数据写入约定持久化目录，访问 3000 端口 | 缺少必填环境变量时 compose 明确报错 |
| Windows Docker | Docker Desktop + SQLite WAL | 按文档叠加 `docker-compose.win.yml`，数据库和上传目录使用命名卷 | 文档明确绑定挂载限制和停止时不得误删命名卷 |
| 源码备用路径 | GitHub v0.6.0 tag、Node.js >=22 | 安装依赖后可启动本地服务；配置文件和命令不指向 `main` | Node/Docker 版本不满足时给出可执行的前置检查 |
| PWA 前置 | 需要手机安装 PWA | 文档明确必须先通过 Tailscale 或其他 HTTPS 访问 | 非 HTTPS 仅可浏览器访问，不宣称可安装 PWA |

</frozen-after-approval>

## Code Map

- `README.md` -- 中文主入口；包含演示、源码快速体验、Docker 部署、环境变量和 Windows/Tailscale 说明。
- `README.en.md` -- 英文安装入口；必须与中文主路径、版本和语义一致。
- `docker-compose.yml` -- 正式 Docker 主路径；当前镜像 tag 是 `latest`，需固定为 `0.6.0`。
- `docker-compose.demo.yml` -- 演示路径的应用和 mock LLM 镜像；固定版本避免演示漂移。
- `docker-compose.win.yml` -- Windows Docker Desktop 的命名卷覆盖，不改变其现有职责。
- `docs/部署手册-tailscale.md` -- 现有 Docker、Windows WAL、HTTPS/PWA 和维护说明，作为 README 的细节链接。
- `docs/README.md` -- 文档索引；仅在新增安装文档时同步更新，本 Story 优先复用现有文档。

## Tasks & Acceptance

**Execution:**
- [x] `docker-compose.yml`、`docker-compose.demo.yml` -- 将 GHCR 镜像从 `latest` 固定到 `0.6.0`，保留现有服务、卷和环境变量结构。
- [x] `README.md`、`README.en.md` -- 标注 Docker 为主路径、源码为备用路径；固定 clone/Raw 下载到 `v0.6.0`；补齐必填变量、数据目录、端口、Windows WAL 和 Tailscale HTTPS 前置条件。
- [x] `README.md`、`README.en.md` -- 校对两种语言的主路径命令、版本号和数据隔离表述一致。

**Acceptance Criteria:**
- Given 用户只阅读中文或英文 README，when 按主路径执行安装，then 所有镜像、compose 和下载命令都指向 v0.6.0/0.6.0，不出现受支持路径中的 `latest` 或 `main`。
- Given 用户使用 Docker 部署，when 未设置 `APP_PASSWORD` 或 `SESSION_SECRET`，then compose 在启动前给出明确的缺失变量错误；设置后数据目录、端口和启动命令与文档一致。
- Given 用户在 Windows Docker Desktop 上部署，when 按文档叠加 Windows compose，then 文档清楚说明 SQLite WAL 命名卷例外、访问端口和数据持久化边界。
- Given 用户采用源码备用路径，when checkout v0.6.0 并按 README 执行，then Node.js 前置、配置文件来源和启动命令不依赖 `main` 分支。
- Given 用户需要手机 PWA，when 阅读部署前置说明，then 能识别 HTTPS/Tailscale 是安装 PWA 的必要条件，而不是应用本身提供的公网托管。

## Verification

**Commands:**
- `rg -n "latest|raw.githubusercontent.com/.*/main|git clone" README.md README.en.md docker-compose.yml docker-compose.demo.yml` -- 受支持安装路径不再出现 `latest` 或指向 `main` 的下载命令。
- `rg -n "0\.6\.0|v0\.6\.0|APP_PASSWORD|SESSION_SECRET|3000|WAL|Tailscale|HTTPS" README.md README.en.md docker-compose.yml docker-compose.demo.yml` -- 版本、必填变量、端口、Windows 和 HTTPS 说明均可定位。
- `docker compose -f docker-compose.yml config` -- compose 模板结构有效；缺少变量时可通过临时环境变量完成只读配置展开。

**Manual checks (if no CLI):**
- 对照中英文 README 的主路径命令、版本号和数据目录，确认语义一致且 Docker 主路径显著优先。

## Suggested Review Order

**安装版本边界**

- 固定正式镜像版本
  [`docker-compose.yml:4`](../../docker-compose.yml#L4)

- 固定演示镜像版本
  [`docker-compose.demo.yml:7`](../../docker-compose.demo.yml#L7)

- 固定源码安装版本
  [`README.md:30`](../../README.md#L30)

**双语部署说明**

- 中文主路径与变量说明
  [`README.md:111`](../../README.md#L111)

- 英文主路径与变量说明
  [`README.en.md:62`](../../README.en.md#L62)

### Review Findings

- [x] [Review][Patch] 英文 README 的 Windows 安装路径缺少 `docker-compose.win.yml` 下载步骤，按文档从空目录执行会因文件不存在而失败 [README.en.md:66-75]
- [x] [Review][Patch] 中英文 README 将源码 Demo 密码固定写成 `demo`，但 `scripts/demo.mjs` 允许当前进程的 `APP_PASSWORD` 覆盖，首登说明与实际行为不一致 [README.md:31-44; README.en.md:48-54; scripts/demo.mjs:21-22]
- [x] [Review][Patch] Demo 启动器允许外部 `DATABASE_PATH`、`UPLOAD_DIR`、`NOTES_EXPORT_DIR` 覆盖隔离路径，可能把 Demo 数据写入正式或共享目录 [scripts/demo.mjs:10-22]
- [x] [Review][Patch] Docker Demo 固定 `container_name`，不同 Compose project 无法并行运行，与“project 隔离”说明冲突 [docker-compose.demo.yml:9,30]
- [x] [Review][Patch] 英文 README 未说明 Windows 命名卷例外，默认 `./data/*` 表述会误导数据库和图片查找位置 [README.en.md:77]
- [x] [Review][Patch] 首屏源码 Demo 命令未明确 Node.js >=22 前置条件，旧 Node 环境失败时缺少可执行提示 [README.md:31-35; README.en.md:48-52]
