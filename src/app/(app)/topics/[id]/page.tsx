import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { notes, topics } from "@/db/schema";
import { getTagsForNotes } from "@/lib/notes";
import { BackButton } from "@/components/back-button";
import { EmptyNotes } from "@/components/note-card";
import { ChatPanel } from "@/components/chat/chat-panel";
import { TopicNotes } from "./topic-notes";

export const dynamic = "force-dynamic";

export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const topic = db.select().from(topics).where(eq(topics.id, id)).get();
  if (!topic) notFound();

  const rows = db
    .select()
    .from(notes)
    .where(eq(notes.topicId, id))
    .orderBy(desc(notes.updatedAt))
    .limit(200)
    .all();
  const tagMap = getTagsForNotes(db, rows.map((n) => n.id));

  return (
    <div>
      <BackButton fallback="/" className="mb-4" />
      <div className="mb-8 flex items-end justify-between gap-4">
        <header className="min-w-0">
          <p className="mb-2 text-[12px] font-semibold tracking-[0.06em] text-ink-48">主题</p>
          <h1 className="truncate text-[34px] font-semibold leading-[1.1] tracking-[-0.4px] md:text-[40px]">
            {topic.name}
          </h1>
          <p className="mt-2 text-[14px] text-ink-48">{rows.length} 条笔记</p>
        </header>
        <Link
          href={`/notes/new?topic=${topic.id}`}
          className="shrink-0 rounded-full bg-action px-4 py-1.5 text-[14px] text-white transition-transform active:scale-95"
        >
          新笔记
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyNotes hint="这个主题下还没有笔记" />
      ) : (
        <TopicNotes notes={rows.map((n) => ({ ...n, tags: tagMap.get(n.id) ?? [] }))} />
      )}
      <ChatPanel scopeType="topic" scopeId={topic.id} contextTitle={topic.name} />
    </div>
  );
}
