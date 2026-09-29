# B1 三页向量字段边界收口审查

日期：2026-09-23。方式：单 Agent 静态审查加现有局部回归；不冒充独立多方审查或浏览器验收。

结论：B1 可按原决定纳入候选，未发现阻断这组三页修复的问题。本轮不修改产品代码。

| 检查 | 实际核对 | 结论 |
|---|---|---|
| 转换入口 | `src/lib/client-note.ts` 解构去掉 embedding，返回新对象 | 不修改数据库原行，保留客户端需要的正文及元数据 |
| 收件箱 | `src/app/(app)/inbox/page.tsx` 在传给 InboxClient 前逐条转换，再补 tags | BLOB 不跨客户端边界 |
| 主题页 | `src/app/(app)/topics/[id]/page.tsx` 向 TopicNotes 传入转换结果 | 主题过滤、回收站过滤和标签仍在原路径 |
| 编辑页 | `src/app/(app)/notes/[id]/page.tsx` 向 NoteEditor 传入转换结果 | 不改变详情的 404、主题及返回路径 |
| 回归有效性 | 三页测试调用实际页面函数，读取输出组件的 props，并检查数据库仍有 Buffer | 能捕获页面绕过 helper 的回归；不等于真实 React/Next 浏览器渲染 |
| 证据归属 | 旧 `code-review-client-note-*` 为提示词与待审内容 | 不计为审查结果，保留文件避免篡改历史 |

运行结果：[原始 JSON](../../docs/验收证据/0.6.1-baseline-2026-09-23/b1.json)与[命令记录](../../docs/验收证据/0.6.1-baseline-2026-09-23/b1-command.json)。两个文件共 **4/4 通过**，没有跳过。使用单 worker、内存数据库和临时上传/Markdown 目录。

既有待办继续保留在 [deferred-work.md](deferred-work.md)：API JSON 路径仍可能返回 embedding；`Omit` 类型不阻止完整 Note 被结构兼容地传入。这些是三页运行时转换之外的问题，本轮不扩大修补范围，也不宣称全部 API 已去掉向量字段。
