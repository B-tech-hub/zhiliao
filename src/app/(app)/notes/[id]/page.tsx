import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { notes, topics } from "@/db/schema";
import { getTagsForNotes } from "@/lib/notes";
import { isVisionConfigured } from "@/lib/llm-config";
import { ChatPanel } from "@/components/chat/chat-panel";
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
      <ChatPanel
        scopeType="note"
        scopeId={note.id}
        contextTitle={note.title || "（无标题笔记）"}
        hasImages={hasImages}
        visionAvailable={isVisionConfigured()}
      />
    </>
  );
}
