import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { notes } from "@/db/schema";
import { markNoteFailed, processNote } from "@/lib/ai/process-note";
import { getTagsForNotes } from "@/lib/notes";
import { insertNote, insertTopic, wipeData } from "../helpers/db";

// 构造 OpenAI 兼容响应：choices[0].message.content 为 JSON 字符串
function llmResponse(obj: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { role: "assistant", content: JSON.stringify(obj) } }] }),
    text: async () => "",
  };
}

function getNote(id: string) {
  const note = getDb().select().from(notes).where(eq(notes.id, id)).get();
  if (!note) throw new Error(`笔记不存在: ${id}`);
  return note;
}

describe("processNote", () => {
  beforeEach(() => wipeData());
  afterEach(() => vi.unstubAllGlobals());

  it("正常路径：写回主题、标题、标签并置 done", async () => {
    insertTopic("t1", "羽毛球");
    insertNote("n1", "今晚羽毛球多球训练");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        llmResponse({ topicId: "t1", confidence: 0.9, title: "羽毛球训练", tags: ["羽毛球", "训练"], summary: null }),
      ),
    );
    await processNote(getDb(), "n1");
    const note = getNote("n1");
    expect(note.topicId).toBe("t1");
    expect(note.title).toBe("羽毛球训练");
    expect(note.aiStatus).toBe("done");
    const noteTags = (getTagsForNotes(getDb(), ["n1"]).get("n1") ?? []).slice().sort();
    expect(noteTags).toEqual(["羽毛球", "训练"].sort());
  });

  it("低置信度归入未分类", async () => {
    insertTopic("t1", "羽毛球");
    insertNote("n1", "随手记的一句话");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => llmResponse({ topicId: "t1", confidence: 0.3, title: "标题", tags: [], summary: null })),
    );
    await processNote(getDb(), "n1");
    const note = getNote("n1");
    expect(note.topicId).toBe("inbox");
    expect(note.aiStatus).toBe("done");
  });

  it("LLM 返回不存在的主题 id 时归入未分类", async () => {
    insertNote("n1", "内容");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => llmResponse({ topicId: "ghost", confidence: 0.95, title: "标题", tags: [], summary: null })),
    );
    await processNote(getDb(), "n1");
    expect(getNote("n1").topicId).toBe("inbox");
  });

  it("用户锁定的字段不被 AI 覆盖", async () => {
    insertTopic("t1", "羽毛球");
    insertNote("n1", "内容", { title: "手改标题", topicLocked: 1, titleLocked: 1, tagsLocked: 1 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        llmResponse({ topicId: "t1", confidence: 0.9, title: "AI标题", tags: ["AI标签"], summary: null }),
      ),
    );
    await processNote(getDb(), "n1");
    const note = getNote("n1");
    expect(note.topicId).toBe("inbox");
    expect(note.title).toBe("手改标题");
    expect(getTagsForNotes(getDb(), ["n1"]).get("n1")).toBeUndefined();
    expect(note.aiStatus).toBe("done");
  });

  it("长笔记写入摘要，短笔记忽略 LLM 给的摘要", async () => {
    insertTopic("t1", "羽毛球");
    insertNote("long", "球".repeat(200));
    insertNote("short", "短内容球");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        llmResponse({ topicId: "t1", confidence: 0.9, title: "标题", tags: [], summary: "一句话摘要" }),
      ),
    );
    await processNote(getDb(), "long");
    await processNote(getDb(), "short");
    expect(getNote("long").summary).toBe("一句话摘要");
    expect(getNote("short").summary).toBeNull();
  });

  it("markNoteFailed 用内容首行兜底标题并去掉 # 前缀", () => {
    insertNote("n1", "# 会议纪要\n正文内容");
    markNoteFailed(getDb(), "n1");
    const note = getNote("n1");
    expect(note.aiStatus).toBe("failed");
    expect(note.title).toBe("会议纪要");
  });

  it("已有标题的失败笔记不改标题", () => {
    insertNote("n1", "正文", { title: "原标题" });
    markNoteFailed(getDb(), "n1");
    expect(getNote("n1").title).toBe("原标题");
  });
});
