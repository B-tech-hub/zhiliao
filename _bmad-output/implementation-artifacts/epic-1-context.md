# Epic 1 Context: GitHub 安装与首次使用教学

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

让新用户从 GitHub 仓库或固定的 v0.6.0 版本开始，在不依赖维护者口头说明的情况下完成安装、登录和第一条笔记闭环。Epic 聚焦双语 README、Docker 与源码安装路径、环境变量、首次使用、故障排查和可追溯证据，不新增安装器、不改变运行时架构，也不承诺 serverless 部署。

## Stories

- Story 1.1: 固化受支持的 GitHub 安装路径
- Story 1.2: 完成全新环境安装冒烟与证据留存
- Story 1.3: 编写首次使用与故障排查教程

## Requirements & Constraints

- Docker 预构建镜像是主安装路径，源码安装是备用路径。
- 所有安装命令、镜像和下载链接必须固定到已验证的 v0.6.0 tag 或明确提交，不能依赖未验证的 `latest` 或 `main`。
- 安装说明必须明确 Node.js、Docker、持久化目录、`APP_PASSWORD`、`SESSION_SECRET` 和端口要求。
- 必须说明 Windows Docker Desktop 的 SQLite WAL 命名卷例外，以及 Tailscale HTTPS 才能安装 PWA 的前置条件。
- 正式数据、演示数据和测试数据必须隔离；文档不得要求真实 API Key 或正式数据进行安装验证。

## Technical Decisions

- Docker compose 继续使用现有单容器长驻架构和 `/data` 数据路径；不引入安装器或 serverless 部署。
- Linux 使用宿主机 `./data` 绑定挂载；Windows Docker Desktop 使用 `docker-compose.win.yml` 命名卷覆盖数据库和上传目录。
- Docker 镜像使用 GHCR 的 `0.6.0` tag；源码路径使用 GitHub `v0.6.0` tag。

## Cross-Story Dependencies

- Story 1.2 依赖 Story 1.1 的主路径和固定版本；Story 1.3 依赖安装、登录和首次笔记闭环可复现。
