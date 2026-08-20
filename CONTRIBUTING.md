# 参与贡献

感谢你对知了感兴趣！Issue、PR、文档改进都欢迎。

## 开发环境

- Node.js ≥ 22

```bash
npm install
cp .env.example .env.local   # 填 APP_PASSWORD / SESSION_SECRET，LLM 三项可先留空
npm run dev
```

不想申请 LLM API Key？运行 `npm run demo` 会启动「内置 mock LLM + 演示数据」的完整联调环境（数据写在 `./data-demo/`，与正式数据完全隔离），AI 归档、主题建议、失败重试等流水线机制都能在本地跑通。

### Windows 注意事项

1. better-sqlite3 与 @node-rs/jieba 均有预编译产物，正常 `npm install` 无需编译器；若安装时报编译错误，安装 Visual Studio Build Tools 后重试。
2. dev 构建目录被占用（句柄锁死）时，可设置 `NEXT_DIST_DIR=.next-verify` 换目录规避。
3. Docker Desktop 的绑定挂载不支持 SQLite WAL，请叠加命名卷配置：`docker compose -f docker-compose.yml -f docker-compose.win.yml up -d`。

## 提交前自检

```bash
npm run check:design
npm run lint
npm test
npm run build
```

## PR 约定

- 改动较大请先开 Issue 讨论，避免方向不合白做一场。
- 一个 PR 只做一件事。
- 标题使用 `feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:` 前缀。
- 行为变化需在 PR 描述中附验证步骤；UI 改动请附截图。
- 涉及数据库结构：必须在 `src/db/migrations.ts` **追加**新迁移（禁止修改已发布的迁移），并在 PR 中说明。
- 架构层面的取舍，请在 `docs/adr/` 补一篇决策记录。

## 项目边界

知了定位为**单用户、自托管**的个人知识库。多用户、SaaS、账号体系类需求不在规划内（见 README 的 Roadmap 一节）。

## 发布流程（维护者）

1. 更新 `package.json` 的 `version`。
2. 把 `CHANGELOG.md` 的「未发布」段落落为新版本号并补上日期。
3. 本地执行 `npm run lint`、`npm test`、`npm run build`，全部通过后提交并先推送 `main`。
4. 推送预发布标签彩排：`git tag v0.x.y-rc1 && git push origin v0.x.y-rc1`。等待 CI、amd64/arm64 镜像构建、manifest 合并校验与预发布 Release 全部成功。
5. RC 全绿后，在同一提交上推送正式标签：`git tag v0.x.y && git push origin v0.x.y`。不要在 RC 与正式标签之间夹带未经彩排的提交。
6. Release 工作流会自动构建多架构镜像并推送至 ghcr.io，同时创建 GitHub Release。发布后确认 `x.y.z`、`x.y` 与 `latest`（正式版本）指向同一多架构 manifest。
7. 首次发布后需到 GitHub Packages 将包设为 public 并关联仓库（一次性操作）。
