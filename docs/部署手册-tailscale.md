# 部署手册：把知识库装进家里电脑，手机随时随地当 App 用（Docker + Tailscale + PWA）

这份手册面向**没有部署经验**的读者：你只需要会装软件、会复制粘贴命令，跟着一步步做即可，大约需要 30–60 分钟。每一步都会解释"在做什么、为什么"，出问题时按第 9 章的症状对照排查。

## 这份手册要做成一件什么事

装完之后你会得到：家里电脑上跑着你的私人知识库；手机通过 Tailscale 访问，并可添加主屏幕图标。数据库和图片保存在自己的设备上；启用外部 AI 服务时，相关笔记内容会按功能发送给你选择的模型供应商。Tailscale 的设备通信加密传输，必要时会经过加密中继。

本手册将应用端口限制为本机，再用 Tailscale Serve 提供 tailnet 内的 HTTPS 入口。仅安装 Tailscale 不会关闭原有的局域网端口、路由器转发或其他公网入口；这些入口需要按实际配置核对。

整体结构一张图：

```
┌──────────────┐      Tailscale 加密隧道       ┌────────────────────────────┐
│   你的手机    │ ◄═══════════════════════════► │      家里的 Windows 电脑     │
│ （主屏幕图标）│    https://…….ts.net          │  Tailscale（收 HTTPS 并转发）│
└──────────────┘    在任何网络下都连通           │  Docker 容器（知识库 :3000） │
                                               └────────────────────────────┘
```

会用到三样东西，各用一句话介绍：

- **Docker**：把应用连同它需要的全部依赖打包成一个"集装箱"，一条命令就能跑起来——你不需要安装 Node.js，也不需要懂数据库。
- **Tailscale**：把你的电脑和手机拉进一个只属于你的"私人虚拟局域网"，设备之间走端到端加密隧道直连，外人进不来；它还免费送一个正规域名和浏览器信任的 HTTPS 证书。
- **PWA**：把网页"钉"到手机主屏幕、当成 App 用的技术。浏览器规定**只有 HTTPS 网站才允许安装 PWA**——这正是需要 Tailscale 的原因。

### 开始前的准备清单

- 一台**常开的 Windows 电脑**（作为"服务器"，下文都这么称呼它）
- 一部手机（Android 或 iPhone）
- 一个 Google、GitHub 或微软账号（注册 Tailscale 时用）
- 30–60 分钟

### 阅读约定（先看一眼，很重要）

- 手册里所有命令都在 **PowerShell** 里执行。打开方式：按键盘上的 Win 键，输入 `powershell`，回车；Windows 11 也可以右键点开始按钮 → 选"终端"。
- 命令**整行复制**，粘贴到 PowerShell 里回车即可。
- 出现 `<尖括号>` 的地方，要替换成你自己的内容，替换后**不保留尖括号**。
- 标着"名词解释"的段落跳过不影响操作；但出了问题回来读一读，能帮你判断卡在哪一环。
- 正文按 Windows 写。用 Linux 服务器或 NAS 的读者，看每章末尾的 **Linux/NAS 备注**。

### 路线图

1 装 Docker → 2 获取固定版本部署文件 → 3 写配置 → 4 拉取镜像并启动 → 5 配 AI（可跳过）→ 6 Tailscale 组网 → 7 手机装 App → 8 日常维护 → 9 出问题查 FAQ

---

## 第 1 章：安装 Docker Desktop

> 这一步在干什么：给电脑装上应用的"运行底座"。装好 Docker，后面的知识库就能一条命令跑起来。

### 1.1 下载

浏览器打开 https://www.docker.com/products/docker-desktop/ ，点 **Download for Windows（AMD64）** 下载安装包。（绝大多数电脑都是 AMD64；只有极少数 ARM 架构的 Windows 设备才选 ARM64。）

### 1.2 安装

双击安装包，选项全部保持默认（特别是 **Use WSL 2 instead of Hyper-V** 保持勾选），装完按提示**重启电脑**。

> **名词解释：WSL2** 是 Windows 内置的一个"迷你 Linux 子系统"，Docker 在 Windows 上靠它干活。安装器会自动帮你启用，你不需要单独学它。

如果安装或启动时弹出 WSL 相关的报错：右键开始按钮 → "终端(管理员)"，执行下面这条命令，然后重启电脑再打开 Docker Desktop：

```powershell
wsl --update
```

### 1.3 首次启动

开始菜单打开 **Docker Desktop**：接受服务协议；提示登录账号、填写问卷时一律可以点 **Skip** 跳过，不影响使用。

### 1.4 确认 Docker 正常在跑

等任务栏右下角的鲸鱼图标停止转动，然后打开 PowerShell 执行：

```powershell
docker ps
```

- 输出一行英文表头（`CONTAINER ID   IMAGE   …`，下面空着也没关系）→ **成功**，Docker 在跑。
- 报 `error during connect` 之类的红字 → Docker 没起来：确认 Docker Desktop 已打开、鲸鱼图标不转了再试；还不行看 FAQ Q1。

### 1.5 顺手勾一个设置（第 8 章要靠它）

点鲸鱼图标打开 Docker Desktop 窗口 → 右上角齿轮（**Settings**）→ **General** → 勾选 **Start Docker Desktop when you sign in**（登录 Windows 后自动启动）。这样电脑重启后服务能自动恢复（详见 8.1）。

> **Linux/NAS 备注**：Linux 一条命令装 Docker：`curl -fsSL https://get.docker.com | sh`；群晖 NAS 在"套件中心"安装 Container Manager。

---

## 第 2 章：获取固定版本的部署文件

本手册的安装步骤继续使用已发布 **v0.6.0**。当前分支已进入 **0.6.1 候选，尚未发布**；不要将当前分支的 Compose 与历史安装包混用。候选变化与待验证范围见 [v0.6.1 草稿](releases/v0.6.1.md)。

> 这一步在干什么：取得 `v0.6.0` 配套的 Compose 和配置模板。第 4 章直接下载 `ghcr.io/b-tech-hub/zhiliao:0.6.0` 预构建镜像，无需在你的电脑上编译源码。

### 2.1 下载固定版本 ZIP

打开 [v0.6.0 发布页](https://github.com/B-tech-hub/zhiliao/releases/tag/v0.6.0)，下载该版本的 **Source code (zip)**，或使用[固定 v0.6.0 ZIP 链接](https://github.com/B-tech-hub/zhiliao/archive/refs/tags/v0.6.0.zip)。不要用仓库默认分支的 **Code → Download ZIP** 代替固定版本。

### 2.2 解压到一个简单的路径

全新安装时把 ZIP 解压到 `D:\apps\`，得到 `zhiliao-0.6.0` 文件夹；可在**第一次启动前**将它命名为 `zhiliao`。下文统一以 `D:\apps\zhiliao` 为例。

已有安装应继续使用原目录，**不要求改名**；例如原来是 `D:\apps\zhiliao-main`，后续命令就仍使用它。Compose 的 project 名受 `-p`、`COMPOSE_PROJECT_NAME`、配置和目录名影响，Windows 卷名跟随实际 project；Linux 绑定目录还受原绝对路径影响。升级时要保留原 project、挂载和 `.env`，不能只凭同名文件夹认定接回了原数据。

路径尽量简单。遇到空应用先按 FAQ Q9 核对实际挂载，不要初始化新库或删除旧容器、旧卷。

### 2.3 进入文件夹并确认内容

PowerShell 里执行（路径按你的实际情况替换）：

```powershell
cd D:\apps\zhiliao
dir
```

列出的文件里应能看到 `docker-compose.yml`、`docker-compose.win.yml`、`.env.example`、`Dockerfile` 这几个名字，说明位置对了。

> 之后各章的命令都默认你已经 `cd` 进了这个文件夹。新开 PowerShell 窗口后，记得先重新 `cd` 进来。

### 2.4 备选方式：git clone

已安装 Git 时，可在尚无 `zhiliao` 子目录的位置执行：

```powershell
git clone --branch v0.6.0 --depth 1 https://github.com/B-tech-hub/zhiliao.git zhiliao
cd zhiliao
```

固定 tag 的检出用于复现该版本。以后升级先选择目标 Release 并对比配置，按 §8.2 操作；`git pull` 不负责选择或切换应用镜像版本。

> **Linux/NAS 备注**：`git clone` 或下载 ZIP 解压，其余相同。

### 2.5 锁定镜像与本机端口

`v0.6.0` 历史 tag 内的 Compose 仍引用 `latest`。因此无论用 ZIP 还是 Git 获取，启动前都要打开 `docker-compose.yml`，把现有 `services.app.image` 行改为：

```yaml
image: ghcr.io/b-tech-hub/zhiliao:0.6.0
```

再把现有 `ports` 下的 `"3000:3000"` 改为 `"127.0.0.1:3000:3000"`，保留其他配置。这让本机浏览器和 Tailscale Serve 仍能连接，普通局域网地址不直接提供应用入口。不要用这两行片段替换整份文件，也不要取消 `build: .` 的注释；源码构建属于 README 的备用路径。

---

## 第 3 章：写配置文件 .env（只需要填两项）

> 这一步在干什么：告诉应用两件事——你的**登录密码**，和一个给"登录通行证"盖章用的**随机密钥**。
>
> **名词解释：.env** 是一个纯文本配置文件，每行一条"名字=值"，Docker 启动应用时会读取它。

### 3.1 从模板复制出配置文件

```powershell
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

（只在 `.env` 不存在时复制模板。已有配置保留原值；升级不要重新覆盖密码、密钥和模型配置。）

### 3.2 生成随机密钥

配置里的 `SESSION_SECRET` 需要一长串随机字符。模板注释里写的 `openssl rand -hex 32` 是 Linux 命令，**Windows 上没有**；用下面这条，效果相同：

```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

会输出一串 64 位的随机字母数字，**选中并复制备用**。

> **名词解释：SESSION_SECRET** 是服务器给浏览器发"30 天登录通行证"时盖的防伪印章。它只给程序用，**你自己永远不需要记住或输入它**，随机生成一次即可。

### 3.3 编辑 .env

```powershell
notepad .env
```

记事本打开后改两行：

- `APP_PASSWORD=` 等号后面填你自己定的登录密码。**记住它——之后手机登录要手动输入。**
- `SESSION_SECRET=` 等号后面替换成上一步复制的那串随机字符。

### 3.4 删掉三行 AI 占位配置（重要，别跳过）

在同一个文件里找到下面三行，**整行删掉**（或把等号后面清空）：

```
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=deepseek-chat
```

为什么：这三行的值是模板里的**假占位符**（`sk-xxx` 不是真钥匙）。留着不删，应用会把它们当成真配置去调用 AI，然后反复失败、把笔记标成"失败"。AI 的正确配置方式在第 5 章——在应用页面里填，有"测试连接"按钮，填错当场就知道。

其余行（`DATABASE_PATH`、`UPLOAD_DIR`、`PORT` 等）**保持原样，不要动**。

### 3.5 检查最终结果

改完后 `.env` 的有效内容应该长这样（`#` 开头的注释行不用管，留着无妨）：

```
APP_PASSWORD=你定的登录密码
SESSION_SECRET=上一步生成的64位随机字符串
DATABASE_PATH=./data/db/app.db
UPLOAD_DIR=./data/uploads
LLM_TIMEOUT_MS=60000
AI_CONFIDENCE_THRESHOLD=0.6
PORT=3000
```

确认无误后保存并关闭记事本。

> **建议加一行时区**：容器里默认是 UTC（比北京时间慢 8 小时）。这不影响记笔记，但「每周回顾」是按周分段的——不设时区的话，周一早上 8 点之前记的东西会被算进上一周。在 `.env` 里加一行 `TZ=Asia/Shanghai` 即可（改完需要重启容器，见第 8 章）。

> **Linux/NAS 备注**：首次安装用 `cp -n .env.example .env` 保留已有配置；密钥用 `openssl rand -hex 32` 生成；编辑用 `nano .env`。

---

## 第 4 章：启动应用

> 这一步在干什么：让 Docker 拉取应用的预构建镜像，并让它在后台常驻运行。

### 4.1 执行主命令

确认 PowerShell 还在自己的项目文件夹里（全新安装示例为 `D:\apps\zhiliao`），先核对解析后的镜像：

```powershell
docker compose -f docker-compose.yml -f docker-compose.win.yml config --images
```

输出必须为 `ghcr.io/b-tech-hub/zhiliao:0.6.0`；仍是 `latest` 时返回 §2.5。确认后逐条执行，任何一步失败都先排错：

```powershell
docker compose -f docker-compose.yml -f docker-compose.win.yml pull app
docker compose -f docker-compose.yml -f docker-compose.win.yml up -d
```

这是**全手册的主命令**，以后改配置还会再见到它。拆开看每一段的意思：

- `-f docker-compose.yml -f docker-compose.win.yml`：叠加两份配置——基础配置 + Windows 专用补丁；
- `up`：启动；`-d`：后台运行（关掉 PowerShell 窗口也不影响）。

启动时会自动从 ghcr.io 下载现成的应用镜像（amd64/arm64 都有），**不需要在你的电脑上编译代码**。想从源码自己构建的进阶做法见 README「部署（Docker）」一节。

> **原理：Windows 为什么要叠第二个文件？**
> 应用的数据库（SQLite）需要一种"共享内存"能力，而 Windows 和容器内 Linux 之间共享文件夹时恰好不支持它（强行用会报 `SQLITE_IOERR_SHMOPEN`）。所以 Windows 上让数据住进 Docker 自己管理的两个"**命名卷**"里：`kb_db`（数据库）和 `kb_uploads`（图片）。
>
> 数据库与图片位于实际 project 对应的命名卷；增量 Markdown 仍通过 `./data/notes` 绑定到宿主机。卷的逻辑名不等于完整卷名，备份前按 §8.2 核对挂载，恢复见 §8.3。

首次执行要下载镜像，**几分钟属于正常**（取决于网速），等它跑完，最后看到 `Started` 或 `Running` 字样即可。

### 4.2 确认容器在跑

```powershell
docker ps
```

列表里应有一行 `zhiliao`，STATUS 显示 `Up …`。

> **名词解释：容器**就是那个跑起来的"集装箱"——应用和依赖都封在里面，与电脑上其他软件互不干扰。容器删掉重建也不影响数据（数据在命名卷里）。

如果没有这一行、或 STATUS 是 `Exited`，看日志找原因（常见报错对照见 FAQ Q3）：

```powershell
docker logs --tail 50 zhiliao
```

### 4.3 在电脑上先试用一下

浏览器打开 http://localhost:3000 ，用 `.env` 里填的 `APP_PASSWORD` 登录。能进入应用界面，这一章就成功了。

> **名词解释**：`localhost` 意思是"这台电脑自己"，`3000` 是应用的"门牌号"（端口）。所以这个地址**只有这台电脑自己打得开，手机现在还打不开——是正常的**，第 6、7 章就是解决这件事。

> **Linux/NAS 备注**：不叠加 Windows 文件；依次使用 `docker compose config --images`、`docker compose pull app`、`docker compose up -d`。数据落在项目文件夹 `./data/`，也要完成 §2.5 的版本与端口设置。

---

## 第 5 章：在应用里配置 AI（可以先跳过）

> 这一步在干什么：AI 负责给你随手记的笔记自动起标题、打标签、写摘要、归入主题。
>
> **不配置 AI，应用也完全可用**——笔记会停留在"待整理"状态；以后任何时候配好，攒下的旧笔记会自动补处理。你可以先跳到第 6 章，回头再弄这里。

### 5.1 申请一个 API Key

以 DeepSeek 为例：打开 https://platform.deepseek.com 注册，在 **API Keys** 页面创建一个 Key，复制那串 `sk-` 开头的字符。（通常需要少量充值才能调用。）

> **名词解释：API Key** 是你在 AI 服务商那里的"计费凭证"，相当于充值卡密码——**不要发给任何人，也不要贴到网上**。

### 5.2 在设置页填入

回到应用（http://localhost:3000）→ 导航里进入 **设置** → 找到 **AI 服务**，填三项：

| 输入框 | 填什么 |
|---|---|
| 接入点 | `https://api.deepseek.com/v1` |
| 模型 | `deepseek-chat` |
| API Key | 刚复制的 `sk-…` |

### 5.3 保存并测试

点 **保存**，再点 **测试连接**——显示成功即可，保存后立即生效，不需要重启任何东西。测试报错的话，对照 FAQ Q7 排查。

### 5.4 看看效果

随手记一条笔记，稍等片刻，它会自动获得标题、标签和摘要并归入合适的主题；之前"待整理"的笔记也会陆续补上。

> 进阶：任何"OpenAI 兼容"的服务都能用，换服务商只需改这三项：
>
> | 供应商 | 接入点 | 模型示例 |
> |---|---|---|
> | DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
> | 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
> | Claude | `https://api.anthropic.com/v1/` | `claude-haiku-4-5` |

---

## 第 6 章：Tailscale——让手机在任何地方都能连回家

> 这一步在干什么（全手册最关键的一章）：
> 完成 §2.5 后，应用端口只绑定本机。Tailscale 将电脑和手机连入同一 tailnet，用端到端加密通信；无法直连时可走加密中继。此路径无需公网 IP 或路由器端口转发，访问权限仍取决于 tailnet 的设备和访问规则。
> 同时，Tailscale 免费给每台设备一个正规域名（`xxx.ts.net`）并自动签发浏览器信任的 **HTTPS 证书**。浏览器规定只有 HTTPS 网站才允许装成 PWA，所以这一章做完，手机既"连得上"、又"装得了"。个人使用完全免费。

### 6.1 注册账号

打开 https://tailscale.com → **Get started**，用 **Google / GitHub / 微软** 账号中任意一个登录（Tailscale 不提供"用户名+密码"式注册，必须借用三家之一的账号）。登录成功会进入它的管理台。

> **名词解释：tailnet** 就是"你的私人小网络"，你名下装了 Tailscale 的所有设备都在里面。

### 6.2 电脑安装 Tailscale

下载 Windows 版：https://tailscale.com/download/windows → 安装 → 点任务栏的 Tailscale 图标 → **Log in**，浏览器弹出授权页，用 6.1 的账号登录并确认。图标菜单显示 **Connected** 即成功，全程不需要命令行。

### 6.3 开启 HTTPS 证书功能

浏览器打开管理台的 DNS 页面 https://login.tailscale.com/admin/dns ：

1. 确认 **MagicDNS** 处于启用状态（新账号默认开启）；
2. 找到 **HTTPS Certificates** 一栏，点 **Enable HTTPS**；
3. 页面会显示你的 tailnet 域名（形如 `tailxxxx.ts.net`），扫一眼记住样子即可。

> **名词解释：MagicDNS** 给每台设备起一个好记的域名（用设备名，而不是一串数字 IP）；**HTTPS 证书**则是浏览器认可的"网站身份证"，有它浏览器才显示小锁、才允许装 PWA。

### 6.4 把应用包装成 HTTPS 地址

PowerShell 里执行（在哪个目录都行，不需要在项目文件夹）：

```powershell
tailscale serve --bg 3000
tailscale serve status
```

第一条的意思：让 Tailscale 在这台电脑上开一个 HTTPS 入口，把访问转发给本机 3000 端口上的应用；`--bg` 表示后台常驻、**重启电脑后配置依然保留**。

第二条会输出最终地址，形如：

```
https://<你的电脑名>.<tailnet名>.ts.net/
|-- proxy http://127.0.0.1:3000
```

**这个 `https://` 开头的地址，就是手机上要用的最终地址——抄下来。**

几个小提示：

- 报"tailscale 不是内部或外部命令"→ 关掉这个 PowerShell 窗口重开一个再试（旧窗口不认识刚装的新命令）。
- 报语法错误 → Tailscale 版本太旧，去官网装最新版。
- 先在**电脑**浏览器打开这个地址自测。**首次打开要现场签发证书，转圈约 1 分钟属正常**，稍等或刷新即可。
- 嫌地址里的电脑名难看？管理台 **Machines** 页面可以给设备改名，地址会跟着变。

### 6.5 手机安装 Tailscale

手机应用商店搜索 **Tailscale** 安装 → 打开 → 用**同一个账号**登录 → 按提示允许创建 VPN 配置 → 保持 App 里的**开关处于开启**。

> 放心：这个"VPN"只是把手机接进你自己的小网络，**不是翻墙工具**，不改变日常上网，耗电也可以忽略。

验证：电脑 PowerShell 执行 `tailscale status`，列表里应同时看到电脑和手机两台设备。

> **Linux/NAS 备注**：安装 `curl -fsSL https://tailscale.com/install.sh | sh`；登录 `sudo tailscale up`；之后 `sudo tailscale serve --bg 3000`，其余相同。

---

## 第 7 章：手机访问并安装成 App

> 这一步在干什么：把网页"钉"到手机主屏幕，得到一个有独立图标、全屏打开、断网也有提示页的"App"。

### 7.1 手机登录

手机浏览器打开第 6 章抄下的 `https://….ts.net` 地址，用 `APP_PASSWORD` 登录。登录一次管 30 天，装成 App 后共用这个登录状态。

### 7.2 安装

- **Android（用 Chrome 打开）**：右上角 ⋮ 菜单 → **"安装应用"**（有的版本叫"添加到主屏幕"）→ 确认。
- **iPhone / iPad**：⚠️ **必须用 Safari 打开**（iOS 上其他浏览器装不了）。底部**分享**按钮（方框加向上箭头）→ **"添加到主屏幕"** → 确认。

### 7.3 从图标打开

回到主屏幕，点新出现的图标——应用应以**无地址栏的独立全屏窗口**打开，观感和普通 App 无异。

### 7.4 装完检查清单

| 检查项 | 预期 |
|---|---|
| 手机打开 https 地址并登录 | 正常进入应用 |
| 主屏幕图标 | 深色底白色书本图标（不是白块） |
| 从图标打开 | 独立全屏窗口，无地址栏 |
| 开飞行模式后从图标打开 | 显示应用风格的"网络不可用"页 |
| 系统切深色模式（应用外观设为"跟随系统"） | App 立即跟着变暗 |
| 应用内 设置 → 外观 锁定"浅色"或"深色" | 立即生效，重进保持 |

到这里，部署全部完成 🎉。最后花五分钟读第 8 章——都是以后一定会遇到的事。

---

## 第 8 章：日常维护（就四件事）

### 8.1 电脑重启后，服务会自己恢复吗？

大部分环节都会自己恢复，链条如下：

| 环节 | 要不要管 |
|---|---|
| Tailscale 连接 | 不用管——它是系统服务，开机自动连 |
| HTTPS 转发（serve） | 不用管——`--bg` 的配置永久保存 |
| 应用容器 | 不用管——配置了"只要 Docker 在跑就自动拉起" |
| **Docker Desktop 本身** | **要管**——它要等你**登录进 Windows 桌面**后才启动（且需 1.5 勾过自启） |
| **电脑别睡着** | **要管**——睡眠状态下手机连不上 |

所以你只需保证两件事：

1. 1.5 的自启已勾选（Docker Desktop → Settings → General → **Start Docker Desktop when you sign in**）；
2. 关掉睡眠：**设置 → 系统 → 电源** → 把"接通电源时，使设备进入睡眠状态"设为**从不**（屏幕可以关，睡眠不行）；笔记本再到 控制面板 → 电源选项 → "选择关闭盖子的功能" → 设为"不采取任何操作"。

> 提示：重启后需要有人**登录一次 Windows**，Docker 才会起来。想做到完全无人值守，可自行搜索"Windows 自动登录 netplwiz"。

验证方法：重启电脑 → 登录 Windows → 等 1–2 分钟 → 手机直接打开 App，能用就说明整条链路通了（连不上按 FAQ Q8 逐环排查）。

### 8.2 怎么升级新版本

固定镜像后，单独 `pull` 只获取当前指定版本。升级需要先选择目标已发布版本，并修改 `image:`；不要把它改回 `latest`。

先在原部署目录核对现有容器（默认名 `zhiliao`，自定义过则替换）。下面只显示镜像、project 和挂载，不输出环境变量中的密钥：

```powershell
$deployment = @(docker inspect zhiliao | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $deployment.Count -ne 1) { throw '无法识别原容器，请先核对容器名。' }
$projectName = $deployment[0].Config.Labels.'com.docker.compose.project'
$deployment[0].Config.Image
$deployment[0].Image
$projectName
$deployment[0].Mounts | Select-Object Type, Name, Source, Destination
```

保留这些记录，以及原 Compose、`.env` 和[数据库/图片配对备份](备份与恢复.md#snapshot-copy)。备份含密钥和正文，保存在自己的受控位置。`projectName` 为空时，先查清原启动方式，不要猜卷名。

阅读目标版本的 Release Notes，在原目录对比所需配置修改，保留原挂载、本机端口和 `.env`；只将 `image:` 改为目标固定版本。然后逐条执行：

```powershell
if (-not $projectName) { throw '缺少原 project 名，停止升级。' }
docker compose -p $projectName -f docker-compose.yml -f docker-compose.win.yml config --images
docker compose -p $projectName -f docker-compose.yml -f docker-compose.win.yml pull app
docker compose -p $projectName -f docker-compose.yml -f docker-compose.win.yml up -d
```

镜像核对须匹配目标版本，拉取失败则停止；原命令另有 `--env-file` 时继续传入原文件。Linux 省略 Windows 文件，但同样保留实际 project 和绑定路径。部署后记录镜像 ID/digest、检查登录、原笔记、图片、搜索、导出和重启持久化。

启动会自动迁移数据库并恢复 AI 任务。**迁移后的数据库不应直接交给旧镜像作为回退。** 失败时先停服务并保护现有数据，用升级前备份在独立目标恢复，见[恢复与回退](备份与恢复.md#isolated-restore)。遇到 `container name zhiliao is already in use` 时先核对原实例，不删除旧容器来绕过冲突。

### 8.3 数据在哪、怎么备份

Windows 主路径有三处数据位置：

- `kb_db`：数据库 + 应用自动做的**每日备份**（数据库快照与图片快照各保留最近 7 份）；
- `kb_uploads`：笔记里的图片。
- `./data/notes`：宿主机上的增量 Markdown 导出，仍是绑定目录。

前两项是逻辑卷名，实际完整卷名用 §8.2 的挂载记录确认。Windows 下命名卷通常位于 Docker 管理的虚拟磁盘中，不能按宿主机 `data/db`、`data/uploads` 查找。

在 **设置 → 数据 → 立即备份** 完成后，核对同一 UTC 日期的 `app-YYYY-MM-DD.db` 和完整 `uploads-YYYY-MM-DD/`，再停止源实例，将这两项复制到一个新的受控目录。完整命令、离线恢复、写权限和 WAL/SHM 处理见[备份与恢复](备份与恢复.md#snapshot-copy)。**当天数据库快照加“当前 uploads”不等于配对快照。**

日常自动备份与原库同盘，不能抵御整机或磁盘损坏；将核对过的配对快照和部署记录再保存到另一台设备或加密异地存储。最近备份时间本身不能证明图片完整。

正式实例不要执行 `docker compose down -v`，也不要在 Docker Desktop 删除原数据卷。Linux/NAS 的数据通常在原部署目录 `./data/`（含 `db/`、`uploads/`、`notes/`）；整目录冷备必须先停止所有写入进程，保留完整 SQLite 文件集。

### 8.4 怎么改登录密码

```powershell
cd D:\apps\zhiliao
notepad .env
```

改 `APP_PASSWORD=` 后面的值，保存，然后让新配置生效：

```powershell
docker compose -f docker-compose.yml -f docker-compose.win.yml up -d
```

> 为什么要重跑这条命令：密码这类配置是容器**启动时**一次性注入的，改了文件必须重建容器才生效。这次不用加 `--build`（代码没变），几秒就好。
>
> 改密码**不会**把已登录的手机踢下线（30 天通行证还在有效期）。想让所有设备立刻退出登录：把 `SESSION_SECRET` 也换成新的随机串（生成方法见 3.2），再重跑上面的命令。

### 8.5 常用命令速查

都在 PowerShell、项目文件夹下执行：

| 想做什么 | 命令 |
|---|---|
| 看应用是否在跑 | `docker ps` |
| 看应用日志（排错用） | `docker logs --tail 50 zhiliao` |
| 启动 | `docker compose -f docker-compose.yml -f docker-compose.win.yml up -d` |
| 升级到新版本 | 先按 §8.2 备份并更新目标固定版本，核对 project、镜像与挂载，再拉取和启动 |
| 改 `.env` 后使之生效 | `docker compose -f docker-compose.yml -f docker-compose.win.yml up -d` |
| 停止应用 | `docker compose -f docker-compose.yml -f docker-compose.win.yml down`（**绝不要加 `-v`**） |
| 看 HTTPS 转发配置 | `tailscale serve status` |
| 取消 HTTPS 转发 | `tailscale serve --https=443 off` |
| 看组网设备在线状态 | `tailscale status` |

---

## 全新环境安装冒烟（维护者）

需要证明安装路径可重复时，在仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-fresh-install.ps1 -Image ghcr.io/b-tech-hub/zhiliao:0.6.0
```

脚本默认从脚本所属仓库的 `package.json` 读取版本，当前为尚未发布的 `0.6.1`；上面的 `-Image` 明确选择已发布 `0.6.0`。也可指定已生成的固定 RC tag 或 digest；不接受 `latest` 或 `0.6`。增加 `-PrintConfig` 只预览包版本、目标镜像与端口，不创建目录、不读取 Docker 状态、不拉取镜像或启动容器。

获准执行实际冒烟后，脚本在镜像不存在时尝试拉取，使用临时 Compose project、named volume 和临时 Markdown 目录，验证 `/api/healthz`、登录、首条笔记、SQLite/上传目录、导出和重启持久化。它不读取正式 `.env`、`data/` 或正式 Docker 卷；失败时返回非零并输出容器状态与日志，记录脚本包版本、实际目标镜像、环境、端口、耗时和清理命令。需要排查时加 `-KeepResources` 保留临时资源。

[既有安装记录](验收记录-全新环境安装冒烟-2026-09-09.md)使用了已缓存镜像；它不能证明无缓存下载，也不等同于逐步执行本手册。后续分别记录首次获取、Windows/Linux 与恢复实测，未执行的项保留待验证。

## 第 9 章：常见问题（按症状查）

### Q1：Docker Desktop 装不上 / 起不来（弹 WSL 或 Virtualization 报错、鲸鱼图标一直转）

1. 右键开始按钮 → 终端(管理员)，执行 `wsl --update`，**重启电脑**再试；
2. 打开任务管理器 → "性能"→ CPU，看"虚拟化"是否**已启用**。显示"已禁用"就要进 BIOS 开启：开机时连按 F2 / F10 / Del 之类进 BIOS，把 Intel VT-x（或 AMD SVM）设为 Enabled——不同电脑按键与菜单不同，可搜"你的电脑型号 + 开启虚拟化"；
3. Win+R 输入 `winver` 回车，确认系统是 Windows 11 或较新的 Windows 10；
4. 每做一步改动都**重启电脑**后再试。

### Q2：启动命令报"请在 .env 中设置 APP_PASSWORD"

1. 执行 `dir`：当前文件夹里有 `.env` 吗？没有则说明第 3 章还没做，或者你不在项目文件夹（先 `cd` 进去）；
2. 看文件名是不是被记事本存成了 `.env.txt`（用第 3 章的 `Copy-Item` 命令创建就不会有这个问题）；
3. `notepad .env` 打开，确认 `APP_PASSWORD=` 和 `SESSION_SECRET=` 两行的等号后面真的有值。

### Q3：容器起不来 / localhost:3000 打不开

1. 任务栏鲸鱼图标在吗、停止转动了吗？没有就先打开 Docker Desktop；
2. 执行 `docker ps -a`（带 `-a` 能看到已停止的容器），找 `zhiliao` 那行的 STATUS；
3. 若是 `Exited`，看日志 `docker logs --tail 50 zhiliao`，对照处理：
   - 报 `SQLITE_IOERR_SHMOPEN` → 你用的启动命令少了 Windows 补丁文件。改用第 4 章的完整主命令（带两个 `-f`）重跑；
   - 报 `port is already allocated` → 先确认占用者；只为当前实例将端口改成 `"127.0.0.1:3001:3000"`，之后本机访问用 `localhost:3001`，第 6 章的转发命令也相应改成 `tailscale serve --bg 3001`，不要停掉归属不明的程序；
   - 报 APP_PASSWORD 相关 → 回 Q2。

### Q4：手机打不开 https 地址

按顺序逐环检查，断在哪环修哪环：

1. 手机 Tailscale App 的开关开着吗？登录的和电脑是**同一个账号**吗？
2. 电脑执行 `tailscale status`：手机和电脑都显示在线吗？
3. 电脑执行 `tailscale serve status`：转发配置还在吗？不在就重新执行 `tailscale serve --bg 3000`；
4. 电脑浏览器打开 `http://localhost:3000` 正常吗？不正常先回 Q3；
5. 手机上地址抄全了吗——`https://` 开头、`.ts.net` 结尾，中间没有抄错字符。

### Q5：首次打开一直转圈 / 证书报错

1. 首次访问时 Tailscale 现场签发证书，**等约 1 分钟再刷新**，多数就好了；
2. 还不行，回查 6.3：管理台 DNS 页面的 **HTTPS Certificates** 真的点过 **Enable HTTPS** 吗；
3. 确认用的是域名地址（`xxx.ts.net`）而不是 IP——IP 没有证书。

### Q6：浏览器菜单里找不到"安装应用"入口

1. 确认地址栏是 `https://` 开头的 `.ts.net` 地址（不是 `http://`、不是 IP）；
2. 在地址末尾加上 `/manifest.webmanifest` 访问——应显示一段以 `{` 开头的代码文字；如果跳到登录页，说明服务端放行配置被改动过，属应用问题；
3. iPhone 必须用 **Safari**，Android 建议用 **Chrome**；
4. Android 上入口可能叫"添加到主屏幕"，效果一样。

### Q7：记了笔记，AI 一直不整理（一直"待整理"或显示"失败"）

1. 设置 → AI 服务：三项（接入点 / 模型 / API Key）都填了吗、点过**保存**了吗？
2. 点**测试连接**看具体报错：Key 无效（复制时少了字符？）、接入点写错（结尾一般要带 `/v1`）、网络不通；
3. 登录 AI 服务商后台，看账户**余额**是否用完；
4. 配置修好后旧笔记会自动补处理；也可以打开某条笔记点"重新处理"立刻重试。

### Q8：电脑重启后手机连不上了

按 8.1 的链条逐环检查：

1. 电脑睡着了吗？重启后**有人登录过 Windows** 吗（不登录，Docker Desktop 不会启动）？
2. 任务栏有鲸鱼图标吗？没有就手动打开 Docker Desktop，并检查 1.5 的自启勾选；
3. `docker ps` 看容器在不在——Docker 起来后容器会自动跟着起，稍等片刻；
4. `tailscale serve status` 确认转发配置还在（正常情况 `--bg` 会一直保留）;
5. 手机端 Tailscale 开关是否被系统关掉了，重新打开。

### Q9：升级/挪动文件夹之后，打开变成了全新的空应用，我的笔记呢？！

先停止新增写入并保留现有容器、卷和目录。project 或挂载变化可能让应用连到新空库，但**仅凭卷名不能证明原数据完整**。

1. 用 `docker ps -a` 找到旧容器；按 §8.2 读取它的镜像、Compose project 与 `/data/db`、`/data/uploads`、`/data/notes` 实际挂载。
2. 对照升级前记录。Windows 用 `docker volume ls` / `docker volume inspect <已核对的完整卷名>` 确认原卷仍存在；Linux 核对原绑定目录的绝对路径，移动目录不能只看末尾名字。
3. 原数据及映射确认后，在原部署目录使用原 project、环境文件和挂载重新连接。不要删除旧容器来消除名称冲突，也不要把新空库覆盖到旧位置。
4. 找不到原数据、怀疑数据库损坏或不清楚应接哪个卷时，保留现场并按[隔离恢复](备份与恢复.md#isolated-restore)核验备份；把实际结果记录下来，再决定是否切换。

### 已知小瑕疵（不用修）

- iOS 上状态栏颜色可能与应用底色不完全一致：iOS 对网页状态栏配色的支持随系统版本差异较大，属平台限制，不影响任何功能。
