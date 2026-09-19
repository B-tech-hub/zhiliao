# 知了（zhiliao）

[![CI](https://github.com/B-tech-hub/zhiliao/actions/workflows/ci.yml/badge.svg)](https://github.com/B-tech-hub/zhiliao/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/B-tech-hub/zhiliao)](https://github.com/B-tech-hub/zhiliao/releases)
[![Docker](https://img.shields.io/badge/ghcr.io-b--tech--hub%2Fzhiliao-2496ED?logo=docker&logoColor=white)](https://github.com/B-tech-hub/zhiliao/pkgs/container/zhiliao)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)](Dockerfile)

> **English**: *Zhiliao* (知了, "got it / noted") is a self-hosted, AI-organized personal knowledge base — jot a note, and an LLM titles it, tags it, summarizes it, and files it into the right topic. Hybrid keyword + vector retrieval, MCP server, Next.js 15 + SQLite, single-user, PWA-ready, works with any OpenAI-compatible API. **English quickstart: [README.en.md](README.en.md)**; full documentation is in Simplified Chinese.

主题导向的个人知识库：随手记一条笔记，AI 自动阅读理解，起标题、打标签、写摘要，并归入合适的主题；拿不准的进"未分类"，攒多了 AI 会建议"要不要新建主题 X"。

同一个哲学延到读侧——**找的时候不用想关键词**：关键词（BM25）与语义（向量）双路召回后融合重排，用口语化的转述也能捞回原话措辞完全不同的那条笔记；写作时相关旧笔记自动浮现在侧栏，还会提示哪一条与你当前的结论相反。

**AI 不编造**是产品级承诺，不只作用于问答：引用只放行工具真返回过的笔记 id，来源里没有的会直说没有，不拿模型自己的知识凑数，也不渲染幻觉死链。

**你的字带得走**，这同样是承诺而非功能条目：每次保存都把正文以纯 Markdown 落到 `data/notes/主题/标题-id.md`，不必点导出、不必联网，拿 Obsidian 直接打开那个目录就能读（[ADR-0020](docs/adr/0020-incremental-markdown-export.md)）。导出的 zip 也能原样导回来，笔记、主题、标签、时间戳、摘要与图片逐字段还原——**导出与导入互为逆运算**，不是单向的「支持导出」（[ADR-0024](docs/adr/0024-markdown-zip-import.md)）。哪天你不想用知了了，你的字不跟着一起走。

单用户自用，响应式 Web 应用（手机/电脑浏览器通用）。

> **为什么叫"知了"**：你随手记完，AI 应一声"知了"——是"知道了、已收到"，谐音"知识"，也是夏天的蝉。

![演示：随手记 → AI 自动归档 → 主题建议](docs/screenshots/demo.gif)

## 一键体验（无需 API Key）

首次登录、首条笔记、AI 整理、主题与搜索的连续步骤，以及按症状排错，请先看[首次使用与故障排查教程](docs/首次使用与故障排查.md)。

免费自托管试用从已发布固定版本开始，软件采用 MIT，设备和自选模型的费用按个人使用情况承担。遇到安装、记录、搜索、来源问答或数据出口问题，可按[免费反馈说明](docs/产品规划/开源发布范围与执行清单-2026-09-13.md#free-feedback)记录版本、环境与复现步骤；完整数据恢复见[备份与恢复](docs/备份与恢复.md)。

**版本状态：当前工作区为 0.6.1 候选，尚未发布。** 本页普通安装和源码体验命令继续固定已发布的 v0.6.0；当前分支的 Compose 则以 0.6.1 为待发布目标，不能据此认为新镜像已经可用。变化、独立阻断和待验收项见 [v0.6.1 草稿](docs/releases/v0.6.1.md)。

使用内置演示数据与本地 mock LLM，可在全新独立目录和专用终端中体验「随手记 → AI 自动归档 → 主题建议」，无需申请 API Key。旧版不具备当前候选的模型隔离防护；不要复制 `.env*` 或已有 Demo 数据库。下面的 Bash 命令会清理宿主模型变量，并显式隔离 Markdown 目录；Windows 请用[对应的 PowerShell 命令](docs/首次使用与故障排查.md#v060-source-demo-powershell)。目录已存在时换一个新目录名重新开始，不要跳过 clone 失败继续执行。

```bash
(
  set -e
  git clone --branch v0.6.0 --depth 1 https://github.com/B-tech-hub/zhiliao.git zhiliao-demo-v060
  cd zhiliao-demo-v060
  npm ci
  unset DEMO_MODE APP_PASSWORD SESSION_SECRET DATABASE_PATH UPLOAD_DIR
  for demo_prefix in LLM EMBEDDING VISION IMAGE REASONING; do
    unset "${demo_prefix}_BASE_URL" "${demo_prefix}_API_KEY" "${demo_prefix}_MODEL"
  done
  NOTES_EXPORT_DIR=./data-demo/notes PORT=3000 npm run demo
)
```

v0.6.0 源码启动器允许宿主环境覆盖演示默认配置，而且未设置 `NOTES_EXPORT_DIR`，Markdown 默认写入 `./data/notes`；新建和修改笔记都会安排导出。`DEMO_MODE`、`LLM_*`、`EMBEDDING_*`、`VISION_*`、`IMAGE_*`、`REASONING_*` 与已有 Demo 数据库中的模型配置都可能改变旧版行为，清空环境变量也不能覆盖数据库已保存的模型。上述示例只适用于全新目录与专用环境，不承诺旧版不会发出外部请求；下文的强制覆盖和附加模型禁用仅适用于当前候选。

未覆盖默认配置时，打开 http://localhost:3000 ，密码 `demo`。推荐动线：

1. 新建一条笔记，写「今晚羽毛球多球训练，杀球终于有点下压了」——保存后几秒，AI 自动起标题、打标签并归入「羽毛球」主题；
2. 打开「未分类」——AI 已根据攒下的笔记建议了「跑步」「下厨」两个新主题，一键采纳即可建组迁移；
3. 进「羽毛球」主题页，看长笔记的 AI 一句话摘要。

> 演示中的 AI 是本地 mock（按关键词模拟判断），只为展示产品流程；真实效果取决于你接入的 LLM（见下文「LLM 供应商切换」）。
> 按上述隔离步骤首次启动时，数据库、上传和 Markdown 均位于这个独立 checkout 的 `./data-demo/`。停止该 Demo 后可重置这个隔离目录。若以前按旧命令运行过，`./data/notes` 可能已有导出；仅删除 `data-demo` 不代表完整重置，先核对目录归属，不删除正式目录。

当前 **0.6.1 候选源码**已修复 Demo 接线：`npm run demo` 自动设置 `DEMO_RUNTIME=local`，固定连接 `http://127.0.0.1:8787/v1`；容器未设置标记时，以及标记非法时，固定连接 `http://mockllm:8787/v1`。两种 Demo 都忽略数据库和环境中的外部模型地址，禁用附加模型。上方 clone 命令继续获取历史 v0.6.0；2026-09-14 已完成 Windows 本机受控环境中的源码启动、浏览器闭环、配置污染和 403 验收，见 [R1 结果与验收边界](docs/产品规划/开源发布范围与执行清单-2026-09-13.md#r1-source-demo)及[实测记录](docs/R1源码Demo接线验收-2026-09-14.md)。本次使用临时副本和附加运行保护，不代表无缓存安装、Docker 或发布验收通过。

当前源码启动器固定 `APP_PASSWORD=demo`、演示专用会话密钥及 `./data-demo/` 路径，覆盖宿主同名配置；`PORT` 等未固定变量仍可透传。Docker Demo 的密码继续通过专用 `demo.env` 中的 `DEMO_PASSWORD` 设置。

Docker Demo 使用固定摘要的 Nginx 入口发布宿主机端口并限制实际请求体；app 与 mock LLM 只加入 isolated 内网。当前 [docker-compose.demo.yml](docker-compose.demo.yml) 已固定为 **0.6.1 候选镜像**，需配套 [Nginx 配置](nginx/demo.conf)。以下是镜像实际发布并完成对应验收后的启动步骤，本轮未验证该镜像可拉取：

```bash
printf 'DEMO_PASSWORD=demo\nDEMO_SESSION_SECRET=%s\n' "$(openssl rand -hex 32)" > demo.env
npm run demo:compose -- up -d
```

访问 http://localhost:3210 （默认仅绑定本机，密码默认 `demo`，可在 `demo.env` 中修改 `DEMO_PASSWORD`）；结束体验：`npm run demo:compose -- down -v`。

`npm run demo:compose` 会先清理宿主 `DEMO_*`/`COMPOSE_*`，再执行内部等价命令 `docker compose --env-file demo.env -p zhiliao-demo -f docker-compose.demo.yml`，避免正式 `.env` 或宿主变量污染 Demo。默认 project 为 `zhiliao-demo`，内部网络、入口网络和三个 `demo_*` 命名卷随 project 隔离，不挂载 `./data` 或正式卷。Nginx 仅固定转发到 app，并限制 `200 MiB` 实际请求体；入口默认只绑定 `127.0.0.1`，不会直接暴露到局域网。app 与 mock LLM 位于不分配宿主机网关的 isolated 内网。三个服务均设置 CPU、内存、进程数、只读文件系统和日志轮转上限。

当前候选的入口请求限流仅豁免 `/_next/static/` 下的构建资源，避免并行加载脚本、样式和字体耗尽额度。页面、API 及其他路径仍按入口来源地址限制为 `10r/s`、突发 `40`；所有路径继续受每来源地址 `32` 个连接的限制。`/_next/image` 等动态路径不在豁免范围。局部对照与浏览器结果见[静态资源限流修复验收](docs/R1安装验收-2026-09-15.md#demo-static-rate-limit-repair)。

已运行这套入口且镜像已在本机的实例，更新 `nginx/demo.conf` 后应单独重建入口，让新进程初始化限流区。例如在原部署目录执行 `npm run demo:compose -- up -d --no-deps --force-recreate --no-build --pull never ingress`；内部仍是 `docker compose --env-file demo.env -p zhiliao-demo -f docker-compose.demo.yml`，project 与环境文件沿用实际实例参数。此操作会短暂中断入口，不重建 app/mock 或数据卷。

**版本边界：已发布 v0.6.0 不含本轮 Demo 服务端防护；0.6.1 配置更新不代表补丁镜像已发布。** Nginx 入口已经承担接收正文前的实际请求体限制，当前工作区源码同时保留高风险操作和长度声明检查。公网使用前仍须发布包含当前源码补丁的固定应用镜像，并由宿主机或 Docker 存储层限制 Demo 卷容量；运行复核进度见 [Story 2.2 验收记录](docs/Demo部署隔离验收-2026-09-10.md)。

维护者可用 `scripts/verify-demo-runtime.ps1` 复验本地候选，宿主机需 Node.js 22+。`-Port` 指定回环入口，`-IncludeSse -IncludeNetwork` 在同一次运行中完成 HTTP/SSE 和 20 项网络对照；工具关联独立网络证据，默认清理本次资源，检查、证据或清理失败均返回非零。单独网络检查和代理时限验收仍分别使用 `node scripts/verify-demo-network.mjs --help` 与 `node scripts/verify-demo-proxy-timeouts.mjs --help`。

当前维护者选择 Windows Docker Desktop、仅本机体验。9 月 12 日 B2 的 HTTP/SSE、20 项网络对照与清理均通过；此前四项代理验收继续按原范围复用。业务卷硬配额、实际正式服务边界、公网 HTTPS 和补丁镜像发布仍未完成，不能将本机通过等同于公开部署完成。结果见 [Story 2.2 验收记录](docs/Demo部署隔离验收-2026-09-10.md#b2-local)；工具不自动构建、拉取或发布，拓扑取舍见 [ADR-0026](docs/adr/0026-demo-ingress-isolation.md)。

## 界面预览

### Demo 服务端边界

以下边界已在当前 0.6.1 候选源码实现，尚未作为新版本发布，已发布 v0.6.0 不包含这些补丁：体验模式只保留新建普通笔记、AI 自动整理和主题建议主流程，并按源码/容器运行方式选择固定 mock LLM。设置外部模型、创建或吊销 API Token、备份、导入导出、向量回填、文件上传和模型测试等高风险操作由服务端直接拒绝并返回 HTTP `403`；前端隐藏入口只是辅助提示，不能替代服务端校验。

| 首页 · 浅色 | 主题页 · 深色（AI 标题/摘要/标签） |
|---|---|
| ![首页浅色](docs/screenshots/home-light.png) | ![主题页深色](docs/screenshots/topic-dark.png) |

| 笔记编辑器（Markdown 所见即所得） | 手机端 |
|---|---|
| ![笔记编辑器](docs/screenshots/note-detail.png) | ![手机端](docs/screenshots/mobile.png) |

## 功能

- **主题**：扁平一层，手动增删改；首页与侧栏均可直接新建；内置不可删除的"未分类"；删除主题时笔记自动回落未分类
- **笔记**：Markdown 所见即所得（TipTap），支持直接上传 20 MB 以内的 PNG、JPEG、GIF、WebP 与 HEIC；HEIC 自动生成 JPEG 展示副本并保留原件。桌面笔记详情页使用约 1440px 宽屏画布，正文保持可读宽度并提供 H1–H3 目录；移动端仍为无横向滚动的单栏。正文 2 秒防抖自动保存；删除的笔记进回收站，30 天内可恢复（设置 → 数据 → 回收站）
- **AI 流水线**：保存后异步处理，一次调用完成"选主题 + 起标题 + 提标签 + 写摘要"；置信度低于阈值归未分类；用户手动改过的字段 AI 不再覆盖；失败自动退避重试 3 次，可手动"重新处理"
- **AI 助手**：任意页面右下角唤起，面向整个知识库——检索笔记、读全文、建笔记、追加内容、改分类与标签、删笔记、抓取你给过的网址。每次写操作都在对话里留一张可撤销的卡片，删除前必须由你点确认；结论后标注的引用可点回原笔记。当前打开的笔记/主题作为可摘除的上下文附件带入；笔记含图时可开启「看图」，多图会生成不改动原文件的压缩副本发送给视觉模型。输入区的「深度思考」需先在设置页开启该功能才会出现；它本身是消息级开关，默认关闭且刷新后不记忆，开启后改用独立推理模型、300 秒超时且不展示模型内部思维链
- **来源问答**：先勾几条笔记或几个主题作为来源，AI 只依据它们回答——来源里没有的会直说没有，不拿自己的知识凑数。主题作为来源是"活的"，之后新增到该主题的笔记自动算进来；笔记页与主题页有「以此为来源提问」快捷入口
- **AI 画图**（默认关闭）：在设置页开启并配好图像模型后，对助手说"画一张…"即可生成插图，一键插入当前笔记或存为新笔记（每条消息最多 2 张，防止跑偏烧钱）
- **Mermaid 图表**（默认关闭）：开启后，笔记里的 `mermaid` 代码块直接渲染成流程图/时序图，点图即可回到源码编辑；存的仍是原生 Markdown，导出到 Obsidian 照样能看
- **每周回顾**：每周一凌晨把上一周的笔记梳理成一篇脉络回顾，存进「每周回顾」主题（默认开启，设置页可关，也可手动补生成）
- **主题建议**：未分类攒到 8 条后（或手动触发），AI 聚类给出最多 3 个建议，确认后一键建主题并迁移；逐条采纳，采纳一条不影响其余建议
- **中文搜索**：jieba 分词 + SQLite FTS5 全文检索，标题/标签加权，多词 OR 召回；配置 Embedding 后与向量结果以 RRF 融合，未配置时自动使用 BM25；长笔记按 Markdown 标题切成多块分别建向量、取最高分块计分，末尾的结论不会被前文摊薄（取舍见 [ADR-0023](docs/adr/0023-note-chunking.md)）；不输关键词只点主题时，直接列出该主题下的笔记
- **写作时的相关笔记**：编辑正文停顿约 0.9 秒后，侧栏浮现最多 8 条语义相关的旧笔记（只给标题与摘录，绝不自动改你的正文）；若配了聊天模型，还会指出其中哪条与当前草稿的结论相反——相关是向量能做的，矛盾只有 LLM 看得出来。Embedding 或模型未配置时，编辑保存照常，提示降级为空
- **纠正即学习**：你每次手动改主题 / 改标题 / 改标签，都被存成 few-shot 样例注入后续 prompt（每字段最多 3 条），AI 越用越贴合你的习惯；设置页可关，也可逐条停用
- **对外接入**：设置页主动创建 API Token（**默认不生成，不用的人完全感知不到**），数据库只存 SHA-256 哈希，明文仅在创建时返回一次。权限分 `capture:write`（只能调 `POST /api/external/capture` 建笔记，适配 iOS 快捷指令 / 邮件 / bot）与 `knowledge:read`（读 `GET /api/external/knowledge`，或经 `/api/mcp` 用 `search_knowledge`、`get_knowledge` 两个只读语义工具接入 Claude 等 MCP 客户端）。MCP 暴露的是主题与 AI 摘要这层语义，不是裸 CRUD，也不含删除、改配置等高风险操作
- **增量 Markdown 导出**：每次笔记变更后台写一份 `.md` 到 `./data/notes/主题/标题-id.md`（只出不进、零冲突），你的字不会被关在 SQLite 里——想用 Obsidian 直接打开那个目录即可
- **数据归你**：设置页一键导出全部数据（Markdown + 展示图打包 zip；HEIC 原件额外放入 `assets/originals/`，可导入 Obsidian 等工具）与手动立即备份；导出的 zip 可以原样导回来，也可导入普通 Markdown zip（标题从 front-matter / H1 / 文件名推断，主题识别 `topic` / `category` / 所在目录）。无 id 文件按内容指纹防重复，默认不跑 AI 整理（取舍见 [ADR-0024](docs/adr/0024-markdown-zip-import.md)）
- **外观**：浅色 / 深色 / 跟随系统三态切换（设置 → 外观），偏好保存在本机浏览器
- **PWA**：手机可"添加到主屏幕"当 app 用（需 HTTPS，推荐 Tailscale 方案，见下），断网有离线兜底页
- **安全与运维**：单用户密码登录（30 天会话）、登录限流；每日自动备份数据库与图片（各保留 7 份，[恢复方法](docs/备份与恢复.md)），到期回收站与孤儿数据在备份成功后自动清扫；`/api/healthz` 健康检查，Docker 镜像内置 HEALTHCHECK

> **四项功能默认关闭**：手写摄取、AI 画图、Mermaid 图表、深度思考不出现在默认界面上，需在**设置 → 功能开关**中逐项开启。核心路径只保留「记—找—用」三步，其余的先不占第一屏。关闭只收起入口，已经产生的转写、插图、图表与思考过程照常显示、编辑与导出（取舍见 [ADR-0025](docs/adr/0025-non-core-features-off-by-default.md)）。

## 技术栈

Next.js 15（App Router，全栈单体）· TypeScript · Tailwind CSS 4 · Drizzle ORM + better-sqlite3 · TipTap · @node-rs/jieba · jose · Vitest

> ⚠️ **本应用强依赖长驻进程**（进程内 AI 任务队列 + 定时备份），**不能部署到 Vercel 等 serverless 平台**，请用 Docker 或 `node server.js` 方式长驻运行。

## 文档

**26 篇架构决策记录（[ADR](docs/adr/)）**——每个取舍为什么这么定、当时否掉了什么、留下了什么代价，都写在里面。想学 Next.js 全栈的话，这里可能比源码本身更有用：从 [ADR-0001（LLM 配置为何存数据库）](docs/adr/0001-llm-config-in-db.md) 顺着读到 [ADR-0018（混合检索与向量存储）](docs/adr/0018-hybrid-search.md)、[ADR-0019（Token 与 MCP）](docs/adr/0019-external-access.md)，就是这个应用的完整演进史。

其余专项文档集中在 [docs/](docs/README.md)：[开发规范](docs/开发规范.md)、[UI 规范](docs/UI规范.md)、Tailscale 部署手册和[备份与恢复](docs/备份与恢复.md)。领域术语见 [CONTEXT.md](CONTEXT.md)，Agent 入口见 [AGENTS.md](AGENTS.md)。

## 本地开发

```bash
npm install
cp .env.example .env.local   # 修改其中的密码、密钥、LLM 配置
npm run dev
```

访问 http://localhost:3000 ，用 `.env.local` 中的 `APP_PASSWORD` 登录。

开发协作约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 部署（Docker）

**主路径：Docker 预构建镜像。** 本文使用 `ghcr.io/b-tech-hub/zhiliao:0.6.0`（amd64 / arm64），无需本地构建。以下下载命令只用于全新安装，请先进入一个新建的空目录；已有实例按下方升级说明操作。Windows PowerShell 请按[部署手册第 2–4 章](docs/部署手册-tailscale.md#第-2-章获取固定版本的部署文件)操作。

```bash
# Linux / macOS：下载固定 tag 的部署文件
curl -fL -o docker-compose.yml https://raw.githubusercontent.com/B-tech-hub/zhiliao/v0.6.0/docker-compose.yml
curl -fL -o .env.example https://raw.githubusercontent.com/B-tech-hub/zhiliao/v0.6.0/.env.example
cp -n .env.example .env
```

**启动前必须锁定镜像。** `v0.6.0` 历史 tag 中的 Compose 仍写着 `latest`；下载固定 tag 并不自动锁定镜像。编辑下载的 `docker-compose.yml`，仅把 `services.app.image` 改为下列值，保留其余配置：

```yaml
image: ghcr.io/b-tech-hub/zhiliao:0.6.0
```

编辑 `.env`，设置 `APP_PASSWORD` 和 `SESSION_SECRET`，清空示例 `LLM_*` 占位值；模型可稍后在设置页配置。核对镜像输出必须为 `ghcr.io/b-tech-hub/zhiliao:0.6.0`，再拉取并启动；任一步失败都先排错：

```bash
docker compose config --images
docker compose pull app
docker compose up -d
```

> **源码备用路径**：先用 `git clone --branch v0.6.0 --depth 1 https://github.com/B-tech-hub/zhiliao.git zhiliao-src` 获取完整源码；进入该目录，准备 `.env` 后，把 Compose 的 `image:` 行注释掉、取消 `build: .` 的注释，再执行 `docker compose up -d --build`。仅下载上面两份文件不足以构建。
>
> **Windows Docker Desktop 本地测试**：绑定挂载不支持 SQLite WAL 所需的共享内存（报 `SQLITE_IOERR_SHMOPEN`），请叠加命名卷 override：
> `docker compose -f docker-compose.yml -f docker-compose.win.yml up -d`。镜像核对和拉取也须使用同样的两个 `-f`；完整下载步骤见部署手册。
> Linux 服务器不受影响。

应用监听 3000 端口。默认 Compose 的 `"3000:3000"` 会发布到宿主机所有接口；只经本机或 Tailscale Serve 使用时，按部署手册改为 `"127.0.0.1:3000:3000"`。Tailscale 不会自动关闭原有端口或其他公网入口。手机安装 PWA 必须通过 HTTPS 访问，详见 [部署手册-tailscale.md](docs/部署手册-tailscale.md)。

### 全新环境安装冒烟

维护者可在 Docker 可用的机器上运行隔离冒烟（使用临时密码、named volume 和临时导出目录，不接触正式 `data/`、`.env` 或正式 Docker 卷）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-fresh-install.ps1 -Image ghcr.io/b-tech-hub/zhiliao:0.6.0
```

脚本默认读取所属仓库 `package.json` 的版本，当前为尚未发布的 `0.6.1`；上面的命令显式验证历史 `0.6.0`。`-Image` 可指定固定完整 tag 或 digest，`-PrintConfig` 只输出包版本、目标镜像和端口，不创建资源或调用 Docker。候选镜像未生成前，先用预览核对，不能把历史冒烟结果转记为 0.6.1 通过。

实际冒烟在镜像不存在时尝试拉取，验证健康检查、登录、首条笔记、SQLite/上传目录、Markdown 导出和重启持久化，并生成不含密码/API Key 的记录。失败时返回非零并输出容器状态与最近日志；`-KeepResources` 可保留隔离资源和日志用于诊断，完成后按脚本输出清理。可用 `-Port 3301` 选择未占用的宿主端口。

Linux/默认绑定挂载时数据落在宿主机 `./data/`；Windows Docker Desktop 叠加 `docker-compose.win.yml` 后，数据库和上传文件位于 `kb_db`、`kb_uploads` 命名卷，`./data/notes` 仍保存 Markdown 导出：

| 路径 | 内容 |
|---|---|
| `./data/db/app.db` | SQLite 数据库（WAL 模式） |
| `./data/db/backups/` | 每日自动备份：数据库快照 `app-*.db` 与图片快照 `uploads-*/`，各保留 7 份（[恢复方法](docs/备份与恢复.md)） |
| `./data/uploads/` | 上传的图片 |
| `./data/notes/` | 增量导出的 Markdown（按 `主题/标题-id.md`，只出不进；可直接用 Obsidian 打开） |

### 升级与恢复

升级前先保存[数据库与完整图片的配对快照](docs/备份与恢复.md)，以及原镜像 tag/digest、Compose、`.env`、project 和实际挂载记录。选择目标已发布版本，阅读其 Release Notes，在原部署目录对比并更新所需配置，明确把 `image:` 改到目标固定版本，再核对 `docker compose config --images`、执行 `docker compose pull app` 和 `docker compose up -d`；Windows 三条命令都要叠加 `docker-compose.win.yml`。固定 `0.6.0` 后仅执行 `pull` 不会升级到下一个版本。

沿用原 project、数据挂载和 `.env`；若原命令带 `-p` 或 `--env-file`，后续也继续带上。启动会迁移数据库并恢复后台任务；数据已经迁移后，不能只把镜像改回旧版本作为回退。失败时先停下并保护现有数据，按[隔离恢复与回退步骤](docs/备份与恢复.md#isolated-restore)处理。运行后可用 `docker image inspect ghcr.io/b-tech-hub/zhiliao:0.6.0 --format '{{.Id}} {{json .RepoDigests}}'` 记录实际镜像身份；升级时将命令中的版本换成目标版本。

### 手机安装为 App（PWA）

浏览器要求 PWA 必须运行在 HTTPS 下。单用户自用可用 **Tailscale 组网**，通过 `*.ts.net` 域名与受信任证书访问；将应用端口限制在本机，并核对未启用其他公开入口。完整步骤见 **[docs/部署手册-tailscale.md](docs/部署手册-tailscale.md)**。

### 手机一键记录

设置页可创建专用 `capture:write` Token，并在应用内先完成真实写入自测。iPhone 可按 [手机快捷记录指南](docs/手机快捷记录.md) 配置分享文本、分享网址和语音听写入口，从主屏幕、控制中心或分享菜单直接写入知了。Token 只允许创建笔记，不能读取知识库。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `APP_PASSWORD` | ✅ | 登录密码 |
| `SESSION_SECRET` | ✅ | 会话签名密钥，≥32 字节随机串（`openssl rand -hex 32`） |
| `DATABASE_PATH` | | SQLite 路径，默认 `./data/db/app.db`（Docker 内 `/data/db/app.db`） |
| `UPLOAD_DIR` | | 图片目录，默认 `./data/uploads`（Docker 内 `/data/uploads`） |
| `NOTES_EXPORT_DIR` | | 增量 Markdown 导出目录，默认 `./data/notes`（Docker 内 `/data/notes`）；每次笔记变更后台写入，只出不进 |
| `LLM_BASE_URL` | | OpenAI 兼容接入点的默认值（兜底），如 `https://api.deepseek.com/v1`，可在"设置 → AI 服务"页面覆盖 |
| `LLM_API_KEY` | | 模型服务 API Key 的默认值（兜底），可在设置页覆盖 |
| `LLM_MODEL` | | 模型名的默认值（兜底），如 `deepseek-chat`，可在设置页覆盖 |
| `LLM_TIMEOUT_MS` | | LLM 请求超时，默认 60000（仅支持环境变量） |
| `VISION_BASE_URL` / `VISION_API_KEY` / `VISION_MODEL` | | 视觉模型（AI 读图）的默认值，可在设置页覆盖；接入点与 Key 留空回落文本模型，只有填了模型名才启用 |
| `REASONING_BASE_URL` / `REASONING_API_KEY` / `REASONING_MODEL` | | 深度思考模型；接入点与 Key 留空时回落普通文本模型，`REASONING_MODEL` 必须显式填写。深度请求固定使用 300 秒超时 |
| `IMAGE_BASE_URL` / `IMAGE_API_KEY` / `IMAGE_MODEL` | | 图像模型（AI 画图）的默认值，规则同视觉模型 |
| `IMAGE_TIMEOUT_MS` | | 生图请求超时，默认 180000（仅支持环境变量） |
| `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL` | | 语义搜索 Embedding 接口。三项必须全部显式配置，**不会回落** `LLM_*`；供应商需支持 OpenAI 兼容 `/embeddings` |
| `EMBEDDING_TIMEOUT_MS` | | Embedding 请求超时，默认 60000（仅支持环境变量） |
| `TZ` | | 时区，如 `Asia/Shanghai`。**容器默认 UTC**，会让「每周回顾」按 UTC 分周；按本地时间分周需显式设置 |
| `AI_CONFIDENCE_THRESHOLD` | | 分类置信度阈值，默认 0.6，低于则归未分类 |
| `PORT` | | 监听端口，默认 3000 |
| `DEMO_MODE` | | 设为 `1` 时空库启动会写入演示数据（**仅供一键体验，正式部署请勿设置**） |
| `DEMO_RUNTIME` | | 当前候选 Demo 的固定目标选择：`local` 为本机 mock，缺省或其他值为容器 mock；`npm run demo` 自动设置，正式模式忽略 |
| `NEXT_DIST_DIR` | | 构建输出目录，默认 `.next`；仅在 Windows 下 `.next` 被残留进程句柄锁死、`next build` 卡住时临时改用其他目录 |

未配置 `LLM_*` 时应用照常可用，笔记会停留在"待整理"状态，配置后自动补处理。

未配置 `EMBEDDING_*` 时搜索照常使用 BM25；配置后会自动为新建/修改的笔记生成向量，也可在设置页手动补算。Embedding 配置不继承文本模型配置。

### Embedding 实际验收

拿到供应商信息后，先把 `EMBEDDING_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL` 写入已被 Git 忽略的 `.env.local`，再在隔离环境执行 `node verify-embedding.mjs`。脚本会自动读取 `.env.local`（显式传入的环境变量优先），且只输出接口状态、维度与语义区分度，不回显 API Key。通过后在设置页填写同一组三项，点击“测试连接”，再点击“查看待补算”确认存量笔记数量，最后执行“补算向量”。

验收搜索时，使用与笔记原文不同措辞但语义相近的查询（例如笔记写“又摸鱼了一下午”，查询“拖延”），确认结果中的 `vectorEnabled` 为 `true` 且相关笔记排序靠前；若供应商更换模型或维度，旧向量应计入 `staleEmbeddingCount`，搜索仍能降级到 BM25。API Key 不要写入仓库、日志或交接文档。

> `DATABASE_PATH` 与 `UPLOAD_DIR` 用相对路径时，请注意**不要直接跑 `node .next/standalone/server.js`**：standalone 的 `server.js` 启动时会把工作目录切到自身所在的 `.next/standalone/`，相对路径会解析到那里，于是静默新建一个空库——页面能打开、健康检查也正常，只是数据全都不见了。自建部署走 Docker 镜像即可（镜像内已用绝对路径）；确需手动跑 standalone 产物时，请显式传绝对路径的 `DATABASE_PATH` 与 `UPLOAD_DIR`。

> LLM 配置读取顺序：**设置页保存的值（存数据库）优先，环境变量兜底**。在设置页修改后立即生效，无需重启；详见 `docs/adr/0001-llm-config-in-db.md`。

## LLM 供应商切换

任何 OpenAI 兼容的 Chat Completions 服务均可，直接在"设置 → AI 服务"页面修改接入点 / API Key / 模型，保存后立即生效（也可通过环境变量配置默认值）：

| 供应商 | LLM_BASE_URL | LLM_MODEL 示例 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Claude | `https://api.anthropic.com/v1/` | `claude-haiku-4-5` |

在"设置 → AI 服务 → 测试连接"可验证配置是否可用。

本次图片、宽屏目录与深度思考功能的完整验收步骤见 [功能测试指南](docs/图片与深度思考测试指南.md)。

## Roadmap

> ### 北极星指标：真实笔记数
>
> **在真实笔记数达到 100 条之前，本项目冻结所有新功能开发。**
>
> 这不是谦虚，是纠偏。此前衡量项目的全是产出侧数字——提交数、ADR 篇数、测试通过率，它们没有一个会因为「没人用」而变红，于是「一直在进步」和「一直没人用」可以同时为真。真实笔记数是唯一会因此变红的指标，所以把它立为唯一的北极星。
>
> **不受此约束**：缺陷修复、文档、分发与运维照常推进——已经存在的东西该好用就得好用。
>
> 解冻后，下方「解冻后再评估」的条目重新排期；在那之前，新功能提案先记录、不实现。

**当前交付重点：开源发布与免费使用反馈。** 优先完成可复现安装、核心“记、找、用”、可靠的数据出口与恢复，以及版本和文档一致。公网 Demo 后移，收费招募暂缓；本地演示和文章分发按对应已发布版本推进。MIT、单用户自托管、100 条冻结和原发布门禁保持，具体安排见[当前执行清单](docs/产品规划/开源发布范围与执行清单-2026-09-13.md)。

**缺陷修复**（不受冻结约束）

当前工作区已修复搜索候选截断和长文续读，尚未发布。130 篇固定语料下，助手前五命中从 5/13 提升到 12/13；18902 字符的长文可通过续读完整还原。证据见 [130 篇隔离验收](docs/测试笔记隔离验收-2026-09-08.md)。剩余缺陷：

- 自然问句中的常用词影响关键词排名：“文档给出的圆面积公式是什么？”的目标仍排第 15，关键词“圆面积公式”排第 1。需要单独评估词权重或停用词，原始验收问题继续保留。
- 极短笔记的向量病理：正文只有两三个字的笔记，会在毫不相关的查询上排到第一。候选解法是按内容长度做分数惩罚，或设一个建向量的最小长度
- 批量导入的增量导出性能：每篇新笔记都会触发一次全导出目录扫描；实测成本约为“笔记数 × 主题目录数 × 0.24 ms”，2000 篇 / 30 个主题会在主线程阻塞十余秒。新增笔记没有旧导出路径，应跳过清理扫描
- 图像生成的异步接口适配（DashScope 那类「提交任务 → 轮询」的形态；当前只支持 OpenAI 兼容的同步接口，取舍见 [ADR-0011](docs/adr/0011-image-generation.md)）

**等待真实需求**

- Memos / flomo / Obsidian 专用适配：普通 Markdown zip 已支持；仍缺 Obsidian 的 `![[wiki 嵌入]]`、附件目录解析，以及 Memos / flomo 各自的导出字段映射。**但在出现真实的迁移来源之前不动手**——没有人拿着自己的 Memos 存档来问「能导进来吗」，这些语法适配就是在为想象中的用户写代码

**解冻后再评估**

- 「这条还成立吗」式回顾：把半年前的笔记推回来，问的不是「记住了吗」而是「你现在还这么想吗」
- 首页指标从「共 N 条笔记」改为「本周进 12 条 / 出 3 条」——让「用了多少」可见，而非「存了多少」可见

**暂缓**

- 检索补上第三路 AI 查询改写（当前为 BM25 + 向量两路 RRF 融合）：方案已设计完，但它的验收要求找到「BM25 与向量都召不回、改写后才能召回」的真实样本；笔记量不足时候选池太小，结构上产生不了这种样本，硬上只能拿合成样本自证。故按[计划文档](docs/取用能力收尾计划.md) §5 自己写下的放弃条件暂缓，笔记到百条量级后重新评估

**远期再议**

- 笔记双链、块编辑器

**明确不做**（保持单用户、自托管的定位）

- 多用户 / 注册 / SaaS 化

## 参与与反馈

这是我的第一个开源项目，既是给自己用的工具，也希望对想学习 Next.js 全栈开发的朋友有参考价值（架构取舍都记录在 [ADR](docs/adr/) 里）。欢迎提 Issue 反馈问题、交流想法；也欢迎 PR（改动较大的建议先开 Issue 讨论）。

- 参与方式与开发约定：[CONTRIBUTING.md](CONTRIBUTING.md)
- 安全问题请走私密披露：[SECURITY.md](SECURITY.md)
- 版本历史：[CHANGELOG.md](CHANGELOG.md)

## 许可证

[MIT](LICENSE)
