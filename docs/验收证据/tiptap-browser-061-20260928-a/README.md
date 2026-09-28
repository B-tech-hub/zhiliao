# TipTap 补丁真实浏览器验收 run t061-20260928-a（未通过：脚本预期错误）

**结论：本轮未通过，但原因是验收脚本对「故意引用的不存在图片」预期了错误的状态码，不是产品缺陷。** 按规格失败即停，没有重试；mermaid=1 那一轮没有执行。规格见 [spec-0-6-1-tiptap-browser-acceptance](../../../_bmad-output/implementation-artifacts/spec-0-6-1-tiptap-browser-acceptance.md)。

## 输入

- 使用候选镜像 `zhiliao-r2:0.6.1-0a2819f37699`，镜像 ID 为 `sha256:f262652592dd…`，与 R2 用的是同一个镜像，本轮没有重新构建。镜像身份见 [image.json](image.json)。
- 实例为单个 project `zhiliao-t061-20260928-a`，只绑定 `127.0.0.1:3321`。不配置模型，每周回顾关闭，mermaid=0。
- 浏览器为 Chromium 141.0.7390.37，Playwright 1.64.0-alpha。

## m0 轮结果（2026-09-28 13:18:15–13:18:43 +08:00）

| 检查 | 结果 | 数据库正文（摘录） |
|---|---|---|
| 真实登录 | 通过 | — |
| 工具条设置 50% 宽度并居中，保存后刷新 | 通过；重开后 DOM 中 `width=50%`，左右外边距都是 auto。[截图](browser/m0-01-center.png) | `<img … width="50%" style="display: block; margin-left: auto; margin-right: auto;">` |
| 只设宽度 75% | 通过，没有多出 style。[截图](browser/m0-02-width.png) | `<img … width="75%">` |
| 只设右对齐 | 通过，没有多出 width。[截图](browser/m0-03-right.png) | `<img … style="display: block; margin-left: auto;">` |
| 普通图片 | 通过，保存后仍是 Markdown 写法。[截图](browser/m0-04-plain.png) | `![丁](/api/images/….png)` |
| 图片紧邻表格：编辑单元格后保存重开 | 通过；表格为 2 行，内容是 `[表头,数值],[内容改,42]`，图片仍是 50%，图片与表头不在同一行。[截图](browser/m0-05-table.png) | 图片单独一行，后接 `\| 表头 \| 数值 \|` |
| 危险属性 | **失败并停止** | — |

完整断言见 [browser-m0.json](browser-m0.json) 中的 `dbChecks`。本轮共放行 5 次 PATCH 自动保存和相关笔记的只读请求。`pageErrors`、`consoleErrors`（预期项除外）、`blockedRequests`、`modelRequests`、`dialogs` 都为空。

## 失败原因

危险属性笔记里故意放了一张不存在的图片 `/api/images/missing-xss.png`，用来触发 `onerror`。脚本预期它返回 **404**，实际返回的是 **400**：0.6.1 的图片路由会先校验文件名，含连字符的非 UUID 名称会被判定为非法文件名。守卫把这个 400 当成页面 HTTP 错误，于是立即停止。

也就是说，危险属性这一项的 DOM 断言还没来得及执行，这一项目前**没有结论**，不能算通过，也不能算失败。[失败时截图](browser/m0-failure.png)中页面显示正常，没有弹窗，也没有页面报错。

## 资源与保护

- 实例已停止，3 个卷保留。正式容器 `zhiliao` 的身份和挂载，以及非本轮卷的清单，前后一致（见 [resources-before.txt](resources-before.txt) 和 [resources-after.txt](resources-after.txt)）。本轮只对正式容器执行了 ps/inspect，没有执行 exec。
- 运行时的工具包与 [tools/](tools/) 逐字节一致。归档中不包含 `app.env`；对临时密码和会话密钥做了扫描，没有命中。

## 下一步（需确认）

需要另起一次 run b。改动只有一处：把预期状态从 404 改为 400，或者换成符合文件名规则的缺失图片名。然后在全新实例上重跑 m0 和 m1 两轮。不改产品源码，也不重新构建。
