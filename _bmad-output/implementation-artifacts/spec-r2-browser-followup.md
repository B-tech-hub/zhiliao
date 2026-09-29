---
title: R2 已构建候选的浏览器补验计划
type: chore
created: 2026-09-27
status: done
result: browser-blocked
baseline_commit: b7d50f9a56d68dfcd68c77dc98cf7dd6075c55ac
review_loop_iteration: 0
---

## 当前事实

[run d](../../docs/验收证据/r2-061-20260927-d/README.md) 已完成一次构建、完整数据恢复比对及重启持久化。浏览器登录、短文、长文表格与 PNG 显示正常，但附加的 Playwright APIRequestContext 图片请求因 HTTP 回环地址上的 Secure Cookie 过滤返回 401，按规则停止。后续三个浏览器场景未执行，R2 未通过。

[run a](../../docs/验收证据/r2-browser-061-20260927-a/README.md) 复用同一镜像与 restore 实例执行了单次浏览器矩阵：真实登录与短文通过，长文正文、公式、表格与 PNG 显示正确，页面同源 `fetch` 取到的 PNG 为 200、`image/png`、字节哈希与源快照一致；但脚本守卫按请求方法中断了产品既有的只读 `POST /api/notes/:id/related`，用例失败即停，HEIC、搜索跳转与历史会话来源未执行，R2 仍未通过。本轮未重新构建、未改产品，资源保护、旧证据哈希与凭据扫描通过。

## 已批准的最小范围

1. 保留 run d 的原始 `browser-check.cjs`、`browser.json` 和截图；在新证据目录准备浏览器脚本，图片响应核对改为页面内同源 `fetch(url, { credentials: "same-origin" })`，将状态、MIME 和字节传回内存校验，不输出 Cookie。
2. 不修改产品源码、登录安全属性、依赖或候选输入；不重新构建。复用 `zhiliao-r2:0.6.1-0a2819f37699` 与实际 image ID `sha256:f262652592dd2bd32d00aae44f60d4c98caa2c89ca0942254f77918f57aacb4a`。
3. 仅启动现有 run d 的 restore 专用实例及三卷，仍为 127.0.0.1:3313；source/import 和旧 run c 保持停止，不接触正式数据。
4. 一次浏览器矩阵：真实登录、长短笔记、PNG、HEIC 展示图及字节、关键词结果跳转、历史会话和来源。截图等待页面入场动画结束；保留新的独立结果与截图，不覆盖 run d 原失败。
5. 单 Agent、真实模型预算 0；失败立即停止、不自动重试。完成后停止 restore，正式实例仅做前后只读核对，保留卷；不推送或发布。

## 验收标准与风险

Given 浏览器真实登录，When 在页面中读取两张展示图，Then 200、预期 MIME、96×64 尺寸及源快照字节哈希一致，且不降低产品 Cookie 安全性。

Given 已恢复的源笔记和合成会话，When 打开、搜索、跳转和检查来源，Then 页面内容及来源正确、无未处理浏览器错误、无模型请求；只有本轮浏览器矩阵实际通过，才结合 run d 数据结果判断 R2。

用户已确认本次补验计划，授权上述脚本修正、单次完整浏览器矩阵、收尾归档、文档同步与本地提交；无须重复确认。此前 run d 的失败即停记录保持。

## Code Map

- `docs/验收证据/r2-061-20260927-d/`：原始失败脚本、数据通过结果、截图及快照，只读保留。
- `docs/验收证据/r2-browser-061-20260927-a/`：本次脚本、独立结果、截图及保护核对。
- `%TEMP%/zhiliao-r2-061-20260927-d/`：只读原凭据、seed 与 source-state；不覆盖原现场证据。
- `src/app/api/auth/login/route.ts` 与 `src/components/chat/`：静态核对 Cookie、历史及来源选择器，不改产品。
- `docs/README.md`、R2 操作单、候选范围核对、发布说明、发布执行清单、图片指南、备份指南与 `CHANGELOG.md`：同步当前结论。

## Tasks & Acceptance

- [x] 新目录准备同源 fetch 脚本与精确容器 ID 启停包装；先语法核对。
- [x] 核对原镜像、挂载、端口、候选 276 文件与前置保护快照，单次补验，结束停止 restore；本轮在守卫处失败即停。
- [x] 原始输出逐字节归档、凭据扫描、旧证据与正式资源前后核对。
- [x] 同步文档，单 Agent 审查与局部检查，本地提交。

Given run d 原数据结果有效，When 本轮浏览器六项全部通过且收尾保护通过，Then 仅判定 R2 本机同版本范围通过；任一步失败则留证停止，不自动修复重跑。

## Verification

`node --check` 检查新浏览器脚本；Python 编译检查运行包装；一次真实浏览器矩阵；新归档字节、图片 SHA-256、旧证据及候选哈希、资源前后核对；`git diff --check` 与文档链接检查。不开启全量测试、构建或模型调用。

## 流程裁定

用户明确单 Agent，优先于技能的委派建议；本 Agent 实现和审查。现有确认覆盖本规格范围，本地提交后交付结果，不重复审批，不改变 Story/Sprint 状态。

本轮单次矩阵失败后按规格停止，不自动修复或重跑。请求守卫的只读放行修正与新一轮完整浏览器矩阵属于新范围，随后在 [spec-r2-browser-followup-b.md](spec-r2-browser-followup-b.md) 获准执行；run b 六项全部通过，R2 本机同版本范围据此判定通过。

## Suggested Review Order

- 先看补验实际结果与停止边界。
  [README.md:1](../../docs/验收证据/r2-browser-061-20260927-a/README.md#L1)
- 核对失败用例与守卫日志，确认是脚本误判而非产品缺陷。
  [browser.json:1](../../docs/验收证据/r2-browser-061-20260927-a/browser.json#L1)
- 核对资源保护与旧证据未被改动。
  [protection-check.json:1](../../docs/验收证据/r2-browser-061-20260927-a/protection-check.json#L1)
- 单 Agent 审查记录。
  [review-r2-browser-followup.md:1](review-r2-browser-followup.md#L1)
