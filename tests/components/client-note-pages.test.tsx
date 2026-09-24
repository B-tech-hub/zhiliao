import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { notes } from "@/db/schema";
import { insertNote, insertTopic, wipeData } from "../helpers/db";
import InboxPage from "@/app/(app)/inbox/page";
import TopicPage from "@/app/(app)/topics/[id]/page";
import NotePage from "@/app/(app)/notes/[id]/page";

// 只收集传给子组件的笔记，不渲染客户端组件，避免 Next 路由和编辑器参与。
function collectPassedNotes(node: unknown, bucket: unknown[]) {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collectPassedNotes(child, bucket);
    return;
  }
  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props) return;
  if (Array.isArray(props.notes)) bucket.push(...props.notes);
  if (props.note && typeof props.note === "object") bucket.push(props.note);
  collectPassedNotes(props.children, bucket);
}

function attachEmbedding(id: string) {
  const row = getDb().select().from(notes).where(eq(notes.id, id)).get();
  if (!row) throw new Error(`笔记不存在: ${id}`);
  const embedding = Buffer.from(new Float32Array([1, 0, 0]).buffer);
  getDb()
    .update(notes)
    .set({
      embedding,
      embeddingModel: "embed-model",
      embeddingDim: 3,
      embeddingUpdatedAt: row.updatedAt,
      embeddingChunkCount: 1,
    })
    .where(eq(notes.id, id))
    .run();
}

function expectClientNote(note: unknown, id: string) {
  expect(note).toMatchObject({ id, title: "标题", content: "正文", embeddingModel: "embed-model" });
  expect(note).not.toHaveProperty("embedding");
}

beforeEach(() => {
  wipeData();
});

describe("笔记页面不把 embedding 传给客户端", () => {
  it("收件箱页去掉向量二进制字段", () => {
    insertNote("inbox-note", "正文", { title: "标题" });
    attachEmbedding("inbox-note");

    const passed: unknown[] = [];
    collectPassedNotes(InboxPage(), passed);

    expect(passed).toHaveLength(1);
    expectClientNote(passed[0], "inbox-note");
    expect(getDb().select().from(notes).where(eq(notes.id, "inbox-note")).get()?.embedding).toBeInstanceOf(Buffer);
  });

  it("主题笔记页去掉向量二进制字段", async () => {
    insertTopic("topic-1", "阅读");
    insertNote("topic-note", "正文", { title: "标题", topicId: "topic-1" });
    attachEmbedding("topic-note");

    const passed: unknown[] = [];
    collectPassedNotes(await TopicPage({ params: Promise.resolve({ id: "topic-1" }) }), passed);

    expect(passed).toHaveLength(1);
    expectClientNote(passed[0], "topic-note");
    expect(getDb().select().from(notes).where(eq(notes.id, "topic-note")).get()?.embedding).toBeInstanceOf(Buffer);
  });

  it("笔记编辑页去掉向量二进制字段", async () => {
    insertNote("editor-note", "正文", { title: "标题" });
    attachEmbedding("editor-note");

    const passed: unknown[] = [];
    collectPassedNotes(await NotePage({ params: Promise.resolve({ id: "editor-note" }) }), passed);

    expect(passed).toHaveLength(1);
    expectClientNote(passed[0], "editor-note");
    expect(getDb().select().from(notes).where(eq(notes.id, "editor-note")).get()?.embedding).toBeInstanceOf(Buffer);
  });
});