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

单用户自用，响应式 Web 应用（手机/电脑浏览器通用）。

> **为什么叫"知了"**：你随手记完，AI 应一声"知了"——是"知道了、已收到"，谐音"知识"，也是夏天的蝉。

![演示：随手记 → AI 自动归档 → 主题建议](docs/screenshots/demo.gif)

## 一键体验（无需 API Key）

一条命令在本地体验完整的「随手记 → AI 自动归档 → 主题建议」流程。内置演示数据与本地 mock LLM，不需要申请任何 API Key，也不会发出任何外部请求：

```bash
git clone https://github.com/B-tech-hub/zhiliao.git
cd zhiliao && npm install
npm run demo
```

打开 http://localhost:3000 ，密码 `demo`。推荐动线：

1. 新建一条笔记，写「今晚羽毛球多球训练，杀球终于有点下压了」——保存后几秒，AI 自动起标题、打标签并归入「羽毛球」主题；
2. 打开「未分类」——AI 已根据攒下的笔记建议了「跑步」「下厨」两个新主题，一键采纳即可建组迁移；
3. 进「羽毛球」主题页，看长笔记的 AI 一句话摘要。

> 演示中的 AI 是本地 mock（按关键词模拟判断），只为展示产品流程；真实效果取决于你接入的 LLM（见下文「LLM 供应商切换」）。
> 演示数据在 `./data-demo/`，删除该目录即可重置；正式数据 `./data/` 不受影响。

装了 Docker、不想装 Node？下载 [docker-compose.demo.yml](docker-compose.demo.yml) 后：

```bash
docker compose -f docker-compose.demo.yml up -d
```

访问 http://localhost:3210 （密码 `demo`）；结束体验：`docker compose -f docker-compose.demo.yml down -v`。

## 界面预览

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

**25 篇架构决策记录（[ADR](docs/adr/)）**——每个取舍为什么这么定、当时否掉了什么、留下了什么代价，都写在里面。想学 Next.js 全栈的话，这里可能比源码本身更有用：从 [ADR-0001（LLM 配置为何存数据库）](docs/adr/0001-llm-config-in-db.md) 顺着读到 [ADR-0018（混合检索与向量存储）](docs/adr/0018-hybrid-search.md)、[ADR-0019（Token 与 MCP）](docs/adr/0019-external-access.md)，就是这个应用的完整演进史。

其余专项文档集中在 [docs/](docs/README.md)：设计规范（含暗色模式 token 表）、Tailscale 部署手册、[备份与恢复](docs/备份与恢复.md)。领域术语见 [CONTEXT.md](CONTEXT.md)。

## 本地开发

```bash
npm install
cp .env.example .env.local   # 修改其中的密码、密钥、LLM 配置
npm run dev
```

访问 http://localhost:3000 ，用 `.env.local` 中的 `APP_PASSWORD` 登录。

开发协作约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 部署（Docker）

默认使用预构建镜像 [`ghcr.io/b-tech-hub/zhiliao`](https://github.com/B-tech-hub/zhiliao/pkgs/container/zhiliao)（amd64 / arm64），无需本地构建：

```bash
# 1. 下载 compose 文件与环境变量模板（或直接 git clone 整个仓库）
curl -LO https://raw.githubusercontent.com/B-tech-hub/zhiliao/main/docker-compose.yml
curl -Lo .env https://raw.githubusercontent.com/B-tech-hub/zhiliao/main/.env.example

# 2. 编辑 .env：设置 APP_PASSWORD / SESSION_SECRET（LLM 可稍后在设置页配置）

# 3. 启动
docker compose up -d
```

> **想从源码构建**：把 `docker-compose.yml` 里的 `image:` 行注释掉、取消 `build: .` 的注释，再 `docker compose up -d --build`。
>
> **Windows Docker Desktop 本地测试**：绑定挂载不支持 SQLite WAL 所需的共享内存（报 `SQLITE_IOERR_SHMOPEN`），请叠加命名卷 override：
> `docker compose -f docker-compose.yml -f docker-compose.win.yml up -d`
> Linux 服务器不受影响。

数据全部落在宿主机 `./data/` 目录：

| 路径 | 内容 |
|---|---|
| `./data/db/app.db` | SQLite 数据库（WAL 模式） |
| `./data/db/backups/` | 每日自动备份：数据库快照 `app-*.db` 与图片快照 `uploads-*/`，各保留 7 份（[恢复方法](docs/备份与恢复.md)） |
| `./data/uploads/` | 上传的图片 |
| `./data/notes/` | 增量导出的 Markdown（按 `主题/标题-id.md`，只出不进；可直接用 Obsidian 打开） |

迁移在应用启动时自动执行。升级版本：`docker compose pull && docker compose up -d`（源码构建则 `docker compose up -d --build`），重启不丢数据与未完成的 AI 任务。

### 手机安装为 App（PWA）

浏览器要求 PWA 必须运行在 HTTPS 下。单用户自用推荐 **Tailscale 组网**：免费获得 `*.ts.net` 域名与受信任证书，手机随处可访问且服务零公网暴露。完整步骤见 **[docs/部署手册-tailscale.md](docs/部署手册-tailscale.md)**。

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

**缺陷修复**（不受冻结约束）

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
