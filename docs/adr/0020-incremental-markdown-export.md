# ADR 0020：持续增量 Markdown 导出

## 状态

已采用（2026-08-24）。

## 决策

- 笔记写入、编辑、AI 整理和恢复后，异步更新 `NOTES_EXPORT_DIR`（默认 `./data/notes`）中的 Markdown 文件。
- 文件路径为 `<主题>/<标题>-<noteId>.md`，文件名和主题目录经过 Windows 安全清洗。
- 每次更新先按 `noteId` 清理旧文件，再写入当前路径，避免标题或主题变更留下旧副本。
- 导出失败只记录警告，不阻塞 SQLite 写入；完整 ZIP 导出仍作为手动备份能力保留。
- 本阶段只做单向导出，不做 Markdown 双向导入和冲突合并。
- 容器部署必须把导出目录显式指向挂卷路径：镜像内置 `NOTES_EXPORT_DIR=/data/notes`，`docker-compose.yml` 挂到宿主机 `./data/notes`。

## 后果

用户可以直接用 Obsidian 等工具读取 `data/notes`，并获得低耦合的 Markdown 副本。异步导出存在短暂延迟，进程在写入完成前退出时只能依靠下一次编辑或手动 ZIP 导出修复。

默认值 `./data/notes` 是相对路径，在 standalone 容器里会解析到 `WORKDIR` 下的 `/app/data/notes`——不在任何挂卷内。首版漏了镜像 ENV 与 compose 挂载，导致 Docker 部署下导出的 `.md` 在宿主机不可见、容器重建即全部丢失，而这个功能存在的全部理由正是「你的字不被关在 SQLite 里」。这与 `DATABASE_PATH` 的相对路径陷阱同源：**凡是落盘路径都必须在镜像里写成绝对路径，并同时确认 compose 挂载存在**，两者缺一即静默丢数据。
