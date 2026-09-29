# 0.6.0 → 0.6.1 隔离升级与回退彩排 run u061-20260927-a

结论：**本机范围内 0.6.0 → 0.6.1 就地升级和按手册回退都通过。** 执行时间为 2026-09-27 21:50:59–21:51:20（+08:00），六个阶段一次通过，没有重试，也没有构建镜像。规格见 [spec-0-6-1-upgrade-rollback-rehearsal](../../../_bmad-output/implementation-artifacts/spec-0-6-1-upgrade-rollback-rehearsal.md)。

## 环境与身份

- 平台：Windows Docker Desktop，linux/amd64。两个 project 分别为 `zhiliao-u061-20260927-a-old` 和 `-rollback`，共 6 个专用卷；数据步骤全部使用 `network_mode: none`，不发布端口。
- 旧版镜像：`ghcr.io/b-tech-hub/zhiliao:0.6.0`，ID/digest 为 `sha256:9d74721d9de527b4f37f5fae9f49de37ba5d55b649dbed2293134c19f250c014`，revision `d22ce2b2ad19d460a67d73b2ca83abda224a883a`（与 `v0.6.0` tag 一致）。
- 候选镜像：`zhiliao-r2:0.6.1-0a2819f37699`，ID 为 `sha256:f262652592dd2bd32d00aae44f60d4c98caa2c89ca0942254f77918f57aacb4a`，revision `51f0a54b9878b0f1c1df548f976a2ec7bb17f19b`。这是 R2 通过时使用的同一镜像。两者身份均由 `preflight` 阶段校验，完整信息见 [images.json](images.json)。
- `git diff v0.6.0 51f0a54b… -- src/db/` 输出为空。实测结果与此一致：升级前、升级后和回退后，`_migrations` 都是同样的 14 条（最后一条为 `0014_note_chunks`）。
- 数据全部是合成的，真实模型预算为 0。复用 R2 fixture 的 PNG 和 HEIC 样本，另外加入长文公式/表格、改主题、锁字段、回收站笔记、固定会话与来源。

## 矩阵结果

| 场景 | 实际结果 | 证据 |
|---|---|---|
| 就地升级 | 同一 project 与卷改用 0.6.1 镜像后，compose 重建容器并通过健康检查。迁移记录不变；`integrity/tables/files/exportedNotes/pairedImages/counts` 与 0.6.0 升级前状态一致。0.6.0 上传的 HEIC 展示图和 PNG 均返回 HTTP 200，字节与卷内文件一致；会话、来源、关键词搜索和正文可读 | [old-060-state.json](old-060-state.json)、[old-061-state.json](old-061-state.json)、[old/upgrade-readback.json](old/upgrade-readback.json) |
| 升级后写入 | 0.6.1 新建笔记和 PNG，重启后正文、图片字节与 Markdown 仍在；最终计数 4 条有效笔记、1 条回收站、3 张图片 | [old/persist.json](old/persist.json)、[old-061-final-state.json](old-061-final-state.json) |
| 回退 | 0.6.0 产品备份生成的升级前配对快照，只读复制到空卷后用 0.6.0 启动。启动前后都通过 `integrity_check`，状态与升级前一致，迁移记录完全相同；升级后写入的笔记返回 404，符合预期 | [rollback-before-start.json](rollback-before-start.json)、[rollback-after-start.json](rollback-after-start.json)、[rollback/rollback-readback.json](rollback/rollback-readback.json) |
| 保护边界 | 升级前快照前后哈希一致；正式容器 `zhiliao` 的身份、状态、挂载与非本轮卷清单前后一致；三份应用日志没有 error | [snapshot-before.json](snapshot-before.json)、[snapshot-after.json](snapshot-after.json)、[resources-before.txt](resources-before.txt)、[resources-after.txt](resources-after.txt) |

阶段时间与退出结果见 [stages.jsonl](stages.jsonl)，完整命令输出见 [transcript.txt](transcript.txt)。

## 观测项（不计入通过判定）

- **回退到 0.6.0 后，HEIC 展示图 `…e7fe.jpg` 返回 HTTP 400**；PNG 返回 200。数据库行、原件和展示图的文件哈希都和升级前一致，所以数据本身没有丢失。原因可以直接从 0.6.0 源码确认：`v0.6.0:src/app/api/images/[filename]/route.ts:11` 只放行 `^[a-z0-9]+\.(png|jpg|gif|webp)$` 这种文件名，而 0.6.0 自己上传 HEIC 时生成的展示图文件名是带连字符的 UUID。也就是说，这是 0.6.0 读取 UUID JPEG 的已知缺陷（0.6.1 已修复，见[修复候选](../0.6.1-heic-read-2026-09-27/README.md)）：凡是回退到 0.6.0 的用户，其 HEIC 图片都会暂时无法显示，重新升级后即可恢复。发布说明需要提醒这一点。
- 本轮没有做「0.6.0 直接打开升级后的卷」这一反向降级观测。手册只认「升级前快照 + 旧镜像 + 新目标」这条回退路径。

## 未覆盖范围

本轮不代表以下各项已通过：异地恢复、独立 Linux、arm64、无缓存安装、RC 冒烟、浏览器界面验证（R2 run b 已用同一个 0.6.1 镜像覆盖）、大规模数据，以及从 0.6.0 之前的版本升级。

## 资源与复现

- 流程外操作披露：调查阶段曾在正式容器 `zhiliao` 内执行过一次 `docker exec zhiliao true`（空命令）。该操作不读写数据，也不重启容器；`resources-before/after` 中记录的正式容器 StartedAt 和 RestartCount 前后一致。以后的调查应避免对正式容器执行 exec。

- 两个 app 容器已停止，6 个卷保留，未删除任何资源。
- 工具位于 [tools/](tools/)：由 R2 fixture/inspect/compare/compose 复制扩展而来，另加 `run.ps1`。运行时工作目录中的 `package/` 与 `tools/` 逐字节一致。归档未收录 `*.env` 和 `old-backups/`（后者与 `snapshot/` 内容相同）；凭据扫描没有命中。
- 复现命令（必须换一个新的 run 标记）：`powershell -NoProfile -ExecutionPolicy Bypass -File docs/验收证据/upgrade-060-061-20260927-a/tools/run.ps1 -RunId u061-<日期>-<新标记>`
