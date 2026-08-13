# 部署手册：把知识库装进家里电脑，手机随时随地当 App 用（Docker + Tailscale + PWA）

这份手册面向**没有部署经验**的读者：你只需要会装软件、会复制粘贴命令，跟着一步步做即可，大约需要 30–60 分钟。每一步都会解释"在做什么、为什么"，出问题时按第 9 章的症状对照排查。

## 这份手册要做成一件什么事

装完之后你会得到：家里电脑上跑着你的私人知识库；手机主屏幕上有一个它的 App 图标，无论在家用 WiFi、还是在外面用流量，点开就能用；数据只存在你自己的电脑里，不经过任何第三方服务器，也完全不暴露在公网上。

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

1 装 Docker → 2 下载代码 → 3 写配置 → 4 启动应用 → 5 配 AI（可跳过）→ 6 Tailscale 组网 → 7 手机装 App → 8 日常维护 → 9 出问题查 FAQ

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

## 第 2 章：下载项目代码

> 这一步在干什么：把应用的"图纸"（源代码）放到电脑上。第 4 章 Docker 会照着图纸把应用"盖"起来（这个过程叫**构建**）。

### 2.1 下载 ZIP

浏览器打开项目仓库页面 `<你的仓库地址>` → 点绿色的 **Code** 按钮 → **Download ZIP**。

### 2.2 解压到一个简单的路径

把 ZIP 解压到一个路径简单的位置，本手册以 `D:\apps\` 为例，解压后得到一个形如 `zhiliao-main` 的文件夹。

> ⚠️ **全手册最重要的警告之一：这个文件夹的名字定下来就不要再改，以后升级也必须覆盖回这同一个文件夹。**
> Docker 会用"文件夹名"给你的数据打标签；换个文件夹名再启动，等于挂上一套全新的空数据，看起来就像笔记全丢了（原理见第 4 章，自救见 FAQ Q9）。
>
> 小建议：路径里尽量避免中文和空格（别放"桌面"或"新建文件夹 (2)"里），能少踩很多莫名其妙的坑。

### 2.3 进入文件夹并确认内容

PowerShell 里执行（路径按你的实际情况替换）：

```powershell
cd D:\apps\zhiliao-main
dir
```

列出的文件里应能看到 `docker-compose.yml`、`docker-compose.win.yml`、`.env.example`、`Dockerfile` 这几个名字，说明位置对了。

> 之后各章的命令都默认你已经 `cd` 进了这个文件夹。新开 PowerShell 窗口后，记得先重新 `cd` 进来。

### 2.4 备选方式：git clone

装了 Git 的读者也可以 `git clone <你的仓库地址>`，效果一样，以后升级直接 `git pull`。没用过 Git 就用上面的 ZIP 方式，不必专门去学。

> **Linux/NAS 备注**：`git clone` 或下载 ZIP 解压，其余相同。

---

## 第 3 章：写配置文件 .env（只需要填两项）

> 这一步在干什么：告诉应用两件事——你的**登录密码**，和一个给"登录通行证"盖章用的**随机密钥**。
>
> **名词解释：.env** 是一个纯文本配置文件，每行一条"名字=值"，Docker 启动应用时会读取它。

### 3.1 从模板复制出配置文件

```powershell
Copy-Item .env.example .env
```

（项目自带模板 `.env.example`，这条命令把它复制一份、改名为 `.env`。）

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

> **Linux/NAS 备注**：`cp .env.example .env`；密钥用 `openssl rand -hex 32` 生成；编辑用 `nano .env`。

---

## 第 4 章：启动应用

> 这一步在干什么：让 Docker 照着代码构建应用，并让它在后台常驻运行。

### 4.1 执行主命令

确认 PowerShell 还在项目文件夹里（不确定就重新 `cd D:\apps\zhiliao-main`），执行：

```powershell
docker compose -f docker-compose.yml -f docker-compose.win.yml up -d --build
```

这是**全手册的主命令**，以后升级、改配置都会再见到它。拆开看每一段的意思：

- `-f docker-compose.yml -f docker-compose.win.yml`：叠加两份配置——基础配置 + Windows 专用补丁；
- `up`：启动；`-d`：后台运行（关掉 PowerShell 窗口也不影响）；`--build`：启动前先照图纸构建。

> **原理：Windows 为什么要叠第二个文件？**
> 应用的数据库（SQLite）需要一种"共享内存"能力，而 Windows 和容器内 Linux 之间共享文件夹时恰好不支持它（强行用会报 `SQLITE_IOERR_SHMOPEN`）。所以 Windows 上让数据住进 Docker 自己管理的两个"**命名卷**"里：`kb_db`（数据库）和 `kb_uploads`（图片）。
>
> 直接后果：**你的数据不在项目文件夹的 `data` 子目录里**，而在 Docker 内部（这也是"文件夹名不能改"的原因——命名卷按"文件夹名"归属）。想导出数据做备份，见 8.3。

首次执行要下载和编译不少东西，**几分钟到十几分钟都正常**，等它跑完，最后看到 `Started` 或 `Running` 字样即可。

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

> **Linux/NAS 备注**：不需要 Windows 补丁文件，直接 `docker compose up -d --build`；数据落在项目文件夹 `./data/` 里。

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
> 现在应用只有家里电脑自己能访问。Tailscale 会把你的电脑和手机拉进一个**私人虚拟局域网**——两台设备之间建立端到端加密的直连隧道，不需要公网 IP、不用碰路由器设置，外人完全摸不到你的服务。
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

> ⚠️ **先看这个大坑**：Docker 按"文件夹名"归属数据。把新版本解压到**另一个名字的文件夹**里启动，会挂上一套全新的空数据，看起来就像"笔记全没了"（数据其实还在，自救见 FAQ Q9）。
> 所以记住一条：**升级永远是覆盖回原来那个文件夹，文件夹名保持不变。**

步骤：

1. 从仓库页面下载新版 ZIP；
2. 解压后把内容**覆盖**到原文件夹（本手册例中的 `D:\apps\zhiliao-main`）。你的 `.env` 不在 ZIP 里，不会被覆盖；
3. 在原文件夹重跑主命令：

```powershell
cd D:\apps\zhiliao-main
docker compose -f docker-compose.yml -f docker-compose.win.yml up -d --build
```

数据库结构升级会在启动时自动完成；重建容器**不丢数据**，也不丢没处理完的 AI 任务。

> 如果你不小心在新文件夹里执行了启动命令，会先看到报错"容器名 zhiliao 已被占用（already in use）"——**这是保护信号，不要照网上偏方删除旧容器**，关掉窗口、回原文件夹操作即可。

### 8.3 数据在哪、怎么备份

你的全部数据在 Docker 的两个命名卷里：

- `kb_db`：数据库 + 应用自动做的**每日备份**（保留最近 7 份）；
- `kb_uploads`：笔记里的图片。

Windows 下它们实际藏在 WSL2 的虚拟磁盘里，不方便直接翻文件夹。想导出到普通目录，用命令：

```powershell
mkdir D:\kb-backup
docker cp zhiliao:/data/db/backups D:\kb-backup\db-backups
docker cp zhiliao:/data/uploads D:\kb-backup\uploads
```

（把容器里的数据库备份目录和图片目录复制到 `D:\kb-backup`，之后可再拷去网盘或 U 盘。）

> 应用的每日自动备份防的是"数据写坏"，**防不了"整台电脑坏掉或丢失"**——建议每隔一段时间用上面的命令导出一份放到别处。

> ⚠️ **危险操作，永远不要做**：
> ① 执行 `docker compose down -v`（那个 `-v` 会**删除数据卷**）；
> ② 在 Docker Desktop 界面里删除 `kb_db` / `kb_uploads` 卷。
> 这两个操作等于**删光你的全部笔记和图片**。

> **Linux/NAS 备注**：数据就在项目文件夹 `./data/` 下（`db/`、`db/backups/`、`uploads/`），直接复制该目录即可备份。

### 8.4 怎么改登录密码

```powershell
cd D:\apps\zhiliao-main
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
| 启动 / 升级 | `docker compose -f docker-compose.yml -f docker-compose.win.yml up -d --build` |
| 改 `.env` 后使之生效 | `docker compose -f docker-compose.yml -f docker-compose.win.yml up -d` |
| 停止应用 | `docker compose -f docker-compose.yml -f docker-compose.win.yml down`（**绝不要加 `-v`**） |
| 看 HTTPS 转发配置 | `tailscale serve status` |
| 取消 HTTPS 转发 | `tailscale serve --https=443 off` |
| 看组网设备在线状态 | `tailscale status` |

---

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
   - 报 `port is already allocated` → 3000 端口被其他程序占了：关掉那个程序重跑；或把 `docker-compose.yml` 里 `"3000:3000"` 的**左边**改成别的数字（如 `"3001:3000"`），之后本机访问用 `localhost:3001`，第 6 章的转发命令也相应改成 `tailscale serve --bg 3001`；
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

**先别慌：数据几乎可以肯定没丢。**原因是新文件夹名让 Docker 挂上了一套新的空数据卷，旧数据还躺在旧卷里。

1. 执行 `docker volume ls`，能看到形如 `<原文件夹名>_kb_db` 的卷——那就是你的数据，安然无恙；
2. 把项目代码放回**和原来一模一样名字**的文件夹。原文件夹已被删也没关系——数据卷存在 Docker 内部，认"名字"不认文件夹本体，重建一个同名文件夹即可；
3. 在这个文件夹里重跑主命令（见 8.2），打开应用，笔记就回来了；
4. 以后升级记住一条：**永远覆盖原文件夹**（见 8.2 的警告）。

### 已知小瑕疵（不用修）

- iOS 上状态栏颜色可能与应用底色不完全一致：iOS 对网页状态栏配色的支持随系统版本差异较大，属平台限制，不影响任何功能。
