# 问题跟踪：GitHub

本项目的任务与 PRD 记录在 GitHub Issues，仓库为 `B-tech-hub/zhiliao`。所有操作使用 `gh` CLI；在仓库目录内执行时，由 `git remote` 自动确定仓库。

## 常用操作

- 创建：`gh issue create --title "..." --body "..."`
- 阅读：`gh issue view <编号> --comments`
- 列表：`gh issue list --state open --json number,title,body,labels,comments`
- 评论：`gh issue comment <编号> --body "..."`
- 增删标签：`gh issue edit <编号> --add-label "..."` / `--remove-label "..."`
- 关闭：`gh issue close <编号> --comment "..."`

当 skill 要求“发布到问题跟踪器”时，创建 GitHub Issue；要求“读取相关任务”时，读取对应 Issue 及其评论和标签。
