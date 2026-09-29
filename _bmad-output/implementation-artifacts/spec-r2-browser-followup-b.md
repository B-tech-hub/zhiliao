---
title: R2 浏览器补验 b（守卫按只读语义放行）
type: chore
created: 2026-09-27
status: done
result: browser-passed
baseline_commit: 33b5203e238275093290834b5b4231a528bdde22
review_loop_iteration: 0
---

## 授权与目标

用户批准在 run a 因守卫过严停止后修正守卫并重做一次完整浏览器矩阵。范围：只放行 `POST /api/notes/:id/related` 这类只读请求并单独记录，保留模型请求断言；复用 run d 的镜像与 restore 实例，不重新构建、不改产品源码、不重跑数据矩阵；单 Agent、真实模型预算 0；通过后归档、同步文档并本地提交。

## 执行与结果

- 新证据目录 [README.md](../../docs/验收证据/r2-browser-061-20260927-b/README.md)，临时现场 `%TEMP%/zhiliao-r2-browser-061-20260927-b/`。
- 守卫差异见 [browser-check.cjs](../../docs/验收证据/r2-browser-061-20260927-b/browser-check.cjs)：非 `GET`/`HEAD` 请求按只读语义放行相关笔记接口并单独记录，其它方法与模型端点保持阻断。
- 六项用例全部通过：真实登录、短笔记、长文表格与 PNG、HEIC 展示图与字节、搜索跳转、历史会话与来源；`pageErrors`、`consoleErrors`、`failedResponses`、`blockedRequests`、`modelRequests` 均为空，`readOnlyRequests` 只有 1 条相关笔记请求。
- 图片字节与源快照一致：PNG 389 字节、`image/png`；HEIC 展示 JPEG 1997 字节、`image/jpeg`。
- 资源保护：恢复实例停止，正式实例与旧 run c/d 容器、九卷、旧证据 534 个文件哈希前后相同，run a 证据未改动。

## 结论与边界

浏览器矩阵通过，结合 run d 的数据恢复结果，判定 R2 本机同版本范围通过。异地恢复、0.6.0 升级回退、独立 Linux、arm64、无缓存分发、RC 与正式发布仍未验收。

## Suggested Review Order

- 先看结论与六项用例。
  [README.md:1](../../docs/验收证据/r2-browser-061-20260927-b/README.md#L1)
- 核对守卫只读放行范围，确认没有放宽成通用放行。
  [browser-check.cjs:1](../../docs/验收证据/r2-browser-061-20260927-b/browser-check.cjs#L1)
- 核对图片字节、只读请求记录与四类错误列表。
  [browser.json:1](../../docs/验收证据/r2-browser-061-20260927-b/browser.json#L1)
- 核对资源与旧证据保护。
  [protection-check.json:1](../../docs/验收证据/r2-browser-061-20260927-b/protection-check.json#L1)
- 单 Agent 审查记录。
  [review-r2-browser-followup-b.md:1](review-r2-browser-followup-b.md#L1)
