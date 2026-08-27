import { describe, expect, it } from "vitest";
import { buildNoteChunks, CHUNK_MAX_CHARS, CHUNK_MIN_CHARS, CHUNK_MAX_COUNT } from "@/lib/ai/embedding";

// 造一段指定字数、不含标题与空行的正文
function filler(count: number, ch = "甲"): string {
  return ch.repeat(count);
}

function note(content: string, title = "笔记标题", summary: string | null = null) {
  return { title, summary, content };
}

describe("buildNoteChunks 切块策略", () => {
  it("短笔记只有一块——绝大多数笔记不该产生额外行", () => {
    expect(buildNoteChunks(note("一句话正文"))).toHaveLength(1);
    expect(buildNoteChunks(note(filler(CHUNK_MAX_CHARS - 10)))).toHaveLength(1);
  });

  it("按二级标题切分，每块默认带上笔记标题", () => {
    const content = [
      `## 第一节\n${filler(400, "甲")}`,
      `## 第二节\n${filler(400, "乙")}`,
      `## 第三节\n${filler(400, "丙")}`,
    ].join("\n\n");
    const chunks = buildNoteChunks(note(content));
    expect(chunks).toHaveLength(3);
    for (const c of chunks) expect(c.startsWith("笔记标题")).toBe(true);
    // 每块只含自己那一节的正文，互不掺入
    expect(chunks[0]).toContain("第一节");
    expect(chunks[0]).not.toContain("第二节");
    expect(chunks[2]).toContain("第三节");
  });

  it("关掉注入后每块不含笔记标题——两种切法要能实测对比", () => {
    const content = [`## 甲节\n${filler(400, "甲")}`, `## 乙节\n${filler(400, "乙")}`].join("\n\n");
    const chunks = buildNoteChunks(note(content), { injectTitle: false });
    expect(chunks).toHaveLength(2);
    for (const c of chunks) expect(c.startsWith("笔记标题")).toBe(false);
  });

  it("单节超过上限时按空行段落再切", () => {
    const para = `${filler(600, "甲")}\n\n${filler(600, "乙")}\n\n${filler(600, "丙")}`;
    const chunks = buildNoteChunks(note(`## 唯一一节\n${para}`), { injectTitle: false });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
  });

  it("没有任何标题的长正文也能切开——不能因为缺结构就退回整篇一个向量", () => {
    const chunks = buildNoteChunks(note(filler(CHUNK_MAX_CHARS * 3)), { injectTitle: false });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  it("过短的节并入相邻块，不产生无上下文的碎片", () => {
    const content = [
      `## 甲\n${filler(500, "甲")}`,
      `## 乙\n短短一句`,
      `## 丙\n${filler(500, "丙")}`,
    ].join("\n\n");
    const chunks = buildNoteChunks(note(content), { injectTitle: false });
    for (const c of chunks) expect(c.length).toBeGreaterThanOrEqual(CHUNK_MIN_CHARS);
  });

  it("块数封顶，且封顶靠合并而非丢弃——末尾内容进不了向量就是白分块", () => {
    const sections = Array.from(
      { length: CHUNK_MAX_COUNT * 2 },
      (_, i) => `## 第${i}节\n${filler(500, "甲")}结论标记${i}`,
    );
    const chunks = buildNoteChunks(note(sections.join("\n\n")), { injectTitle: false });
    expect(chunks.length).toBeLessThanOrEqual(CHUNK_MAX_COUNT);
    const joined = chunks.join("");
    expect(joined).toContain(`结论标记${CHUNK_MAX_COUNT * 2 - 1}`);
  });

  it("末尾结论必须落在某一块里——这是分块存在的唯一理由", () => {
    const content = `## 铺垫\n${filler(2000, "甲")}\n\n## 结论\n真正的答案是四十二`;
    const chunks = buildNoteChunks(note(content));
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((c) => c.includes("真正的答案是四十二"))).toBe(true);
  });

  it("摘要不进分块——整篇概括注入每块会让块彼此靠近，等于白分块", () => {
    const content = [`## 甲\n${filler(500, "甲")}`, `## 乙\n${filler(500, "乙")}`].join("\n\n");
    const chunks = buildNoteChunks(note(content, "笔记标题", "这是整篇的一句话摘要"));
    expect(chunks).toHaveLength(2);
    for (const c of chunks) expect(c).not.toContain("这是整篇的一句话摘要");
  });

  it("空正文不产生块", () => {
    expect(buildNoteChunks(note("   \n\n  "))).toHaveLength(0);
  });
});
