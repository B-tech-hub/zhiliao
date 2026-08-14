import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { notes, topics } from "@/db/schema";
import { getTagsForNotes } from "@/lib/notes";
import { ChatScopeBinder } from "@/components/chat/chat-scope";
import { NoteEditor } from "./note-editor";

export const dynamic = "force-dynamic";

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  // 回收站中的笔记不可访问详情页，恢复后自动恢复访问
  const note = db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
    .get();
  if (!note) notFound();

  const tagMap = getTagsForNotes(db, [id]);
  const topicRows = db
    .select({ id: topics.id, name: topics.name, isSystem: topics.isSystem })
    .from(topics)
    .orderBy(asc(topics.sortOrder), asc(topics.createdAt))
    .all();

  const hasImages = /\/api\/images\//.test(note.content);

  // 返回兜底：无浏览器历史时回所属主题页；「未分类」是系统主题，其管理页在 /inbox
  const noteTopic = topicRows.find((t) => t.id === note.topicId);
  const backHref = noteTopic?.isSystem ? "/inbox" : noteTopic ? `/topics/${noteTopic.id}` : "/";

  return (
    <>
      <NoteEditor note={note} tags={tagMap.get(id) ?? []} topics={topicRows} backHref={backHref} />
      {/* 把这条笔记登记为助手的上下文附件；助手面板本身挂在 (app)/layout */}
      <ChatScopeBinder
        type="note"
        id={note.id}
        title={note.title || "（无标题笔记）"}
        hasImages={hasImages}
      />
    </>
  );
}
