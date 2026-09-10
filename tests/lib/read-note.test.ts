import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { notes, noteTags, tags } from "@/db/schema";
import { MAX_TOOL_RESULT_CHARS, runTool, type ToolContext } from "@/lib/ai/tools";
import { insertNote, insertTopic, wipeData } from "../helpers/db";

const ctx = (): ToolContext => ({ db: getDb(), userUrls: [] });
const read = (args: Record<string, unknown>, context = ctx()) =>
  runTool("read_note", JSON.stringify(args), context);

function parsePage(content: string) {
  const pointer = content.match(/^nextOffset: (\d+|null)$/m);
  expect(pointer, "每页必须明确给出续读位置或结束标记").not.toBeNull();
  const marker = "\n正文:\n";
  expect(content).toContain(marker);
  return {
    body: content.slice(content.indexOf(marker) + marker.length),
    nextOffset: pointer![1] === "null" ? null : Number(pointer![1]),
  };
}

async function readAll(noteId: string, expected: string) {
  let offset = 0;
  const bodies: string[] = [];
  for (let count = 0; count < 10; count++) {
    const result = await read({ noteId, offset });
    expect(result.error).toBeUndefined();
    expect(result.noteIds).toEqual([noteId]);
    expect(result.content.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
    expect(result.content).not.toContain("结果过长已截断");
    const page = parsePage(result.content);
    expect(page.body.length).toBeLessThanOrEqual(6000);
    expect(page.body).toBe(expected.slice(offset, offset + page.body.length));
    // for...of 按码点迭代；任何孤立的代理项都表示分页拆开了 emoji。
    expect([...page.body].every((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint < 0xd800 || codePoint > 0xdfff;
    })).toBe(true);
    bodies.push(page.body);
    if (page.nextOffset === null) {
      expect(bodies.join("")).toBe(expected);
      return bodies;
    }
    expect(page.nextOffset).toBe(offset + page.body.length);
    expect(page.nextOffset).toBeGreaterThan(offset);
    offset = page.nextOffset;
  }
  throw new Error("续读未在有限页数内结束");
}

describe("read_note 正文续读", () => {
  beforeEach(() => wipeData());

  it("旧调用默认从头读取，短正文与标题、主题、引用保持兼容", async () => {
    insertNote("n1", "短正文", { title: "标题一" });
    const result = await read({ noteId: "n1" });
    expect(result.error).toBeUndefined();
    expect(result.noteIds).toEqual(["n1"]);
    expect(result.content).toContain("标题: 标题一");
    expect(result.content).toContain("主题: 未分类");
    expect(parsePage(result.content)).toEqual({ body: "短正文", nextOffset: null });
    expect(await read({ noteId: "n1", offset: 0 })).toEqual(result);
  });

  it("跟随续读位置能无损拼回长文，页边界不会拆开中文或 emoji", async () => {
    const content = "长".repeat(5999) + "😀" + "文".repeat(5997) + "📝" + "最终证据在文末";
    insertNote("n1", content);
    const pages = await readAll("n1", content);
    expect(pages).toHaveLength(3);
    expect(pages.at(-1)).toContain("最终证据在文末");
  });

  it.each([0, 3, 6000])("正文末尾 offset 返回空页且明确结束（长度 %s）", async (length) => {
    const content = "文".repeat(length);
    insertNote("n1", content);
    const result = await read({ noteId: "n1", offset: content.length });
    expect(result.error).toBeUndefined();
    expect(parsePage(result.content)).toEqual({ body: "", nextOffset: null });
  });

  it.each([-1, 1.5, "6000", null, Number.MAX_SAFE_INTEGER + 1])("拒绝非法 offset：%s", async (offset) => {
    insertNote("n1", "正文");
    const result = await read({ noteId: "n1", offset });
    expect(result.error).toBe(true);
    expect(result.noteIds).toBeUndefined();
    expect(result.content).toContain("offset");
  });

  it("拒绝超出正文的 offset", async () => {
    insertNote("n1", "正文");
    const result = await read({ noteId: "n1", offset: 3 });
    expect(result.error).toBe(true);
    expect(result.noteIds).toBeUndefined();
  });

  it("拒绝落在 emoji 两个代理项中间的 offset", async () => {
    insertNote("n1", "😀正文");
    const result = await read({ noteId: "n1", offset: 1 });
    expect(result.error).toBe(true);
    expect(result.noteIds).toBeUndefined();
  });

  it("续读时重新检查来源范围，拒绝后不透露正文或长度", async () => {
    insertNote("n1", "长".repeat(6500));
    const context = { ...ctx(), allowedNoteIds: new Set(["n1"]) };
    const first = await read({ noteId: "n1" }, context);
    const { nextOffset } = parsePage(first.content);
    context.allowedNoteIds.clear();
    for (const noteId of ["n1", "missing"]) {
      const result = await read({ noteId, offset: nextOffset }, context);
      expect(result.error).toBe(true);
      expect(result.noteIds).toBeUndefined();
      expect(result.content).toContain("不在本次对话的来源集内");
      expect(result.content).not.toContain("正文:");
      expect(result.content).not.toContain("totalLength:");
    }
  });

  it("首读后移入回收站的笔记不能继续读取", async () => {
    insertNote("n1", "长".repeat(6500));
    const first = await read({ noteId: "n1" });
    const { nextOffset } = parsePage(first.content);
    getDb().update(notes).set({ deletedAt: Date.now() }).where(eq(notes.id, "n1")).run();
    const result = await read({ noteId: "n1", offset: nextOffset });
    expect(result.error).toBe(true);
    expect(result.noteIds).toBeUndefined();
  });

  it("长标题、主题和标签不会让外层截断结果或跳过正文", async () => {
    const content = "正文".repeat(6500) + "末尾证据";
    insertTopic("long-topic", "主题".repeat(5000));
    insertNote("n1", content, { title: "标题\n".repeat(5000), topicId: "long-topic" });
    getDb().insert(tags).values({ id: "tag1", name: "标签".repeat(5000) }).run();
    getDb().insert(noteTags).values({ noteId: "n1", tagId: "tag1" }).run();

    await readAll("n1", content);
  });
});
