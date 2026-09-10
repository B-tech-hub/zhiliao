import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, getSqlite } from "@/db";
import { notes } from "@/db/schema";
import { makeExcerpt, rebuildFtsIfNeeded, refreshNoteFts, searchNoteIds, segment } from "@/lib/search";
import { insertNote, wipeData } from "../helpers/db";

describe("search", () => {
  beforeEach(() => wipeData());

  it("segment 对中文分词返回空格连接的词串", () => {
    const out = segment("今晚打羽毛球很开心");
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("羽毛球");
  });

  it("segment 对空白输入返回空串", () => {
    expect(segment("   ")).toBe("");
  });

  it("FTS 检索命中分词后的关键词，且不误伤无关笔记", () => {
    insertNote("n1", "今晚羽毛球多球训练，反手过渡球稳定");
    insertNote("n2", "读书笔记：如何高效学习");
    refreshNoteFts(getDb(), "n1");
    refreshNoteFts(getDb(), "n2");
    const { ids } = searchNoteIds("羽毛球");
    expect(ids).toEqual(["n1"]);
  });

  it("单字查询降级为 LIKE 也能命中", () => {
    insertNote("n1", "羽毛球训练记录");
    refreshNoteFts(getDb(), "n1");
    const { ids } = searchNoteIds("球");
    expect(ids).toContain("n1");
  });

  it("来源外匹配超过旧候选上限时，仍能找到来源内的多词结果", () => {
    for (let i = 0; i < 205; i++) {
      insertNote(`outside-${i}`, "量子领域的计算研究");
      refreshNoteFts(getDb(), `outside-${i}`);
    }
    insertNote("inside", "量子领域的计算研究");
    refreshNoteFts(getDb(), "inside");

    // 故意用非连续的词，避免 LIKE 降级掩盖 FTS 候选漏检。
    const result = searchNoteIds("量子 计算", 5, new Set(["inside"]));
    expect(result.ids).toEqual(["inside"]);
    expect(Object.keys(result.scores ?? {})).toEqual(["inside"]);
  });

  it("来源内搜索不返回来源外的分数", () => {
    for (const id of ["inside", "outside"]) {
      insertNote(id, "羽毛球训练记录");
      refreshNoteFts(getDb(), id);
    }
    const result = searchNoteIds("羽毛球", 5, new Set(["inside"]));
    expect(result.ids).toEqual(["inside"]);
    expect(Object.keys(result.scores ?? {})).toEqual(["inside"]);
    expect(searchNoteIds("羽毛球", 5, new Set()).ids).toEqual([]);
  });

  it("LIKE 降级先限定来源，较新的来源外笔记不能挤掉旧来源", () => {
    insertNote("inside", "羽毛球训练记录", { updatedAt: 1 });
    for (let i = 0; i < 205; i++) {
      insertNote(`outside-${i}`, "羽毛球训练记录", { updatedAt: i + 2 });
    }

    const result = searchNoteIds("球", 5, new Set(["inside"]));
    expect(result.ids).toEqual(["inside"]);
    expect(Object.keys(result.scores ?? {})).toEqual(["inside"]);
    expect(searchNoteIds("球", 5, new Set()).ids).toEqual([]);
  });

  it("失步索引中的回收站和已删除笔记不占用候选名额", () => {
    for (const id of ["trash", "missing", "active"]) {
      insertNote(id, "量子领域的计算研究");
      refreshNoteFts(getDb(), id);
    }
    // 绕过正常删除路径，模拟索引尚未清理的状态。
    getDb().update(notes).set({ deletedAt: Date.now() }).where(eq(notes.id, "trash")).run();
    getDb().delete(notes).where(eq(notes.id, "missing")).run();

    const result = searchNoteIds("量子 计算", 1);
    expect(result.ids).toEqual(["active"]);
    expect(Object.keys(result.scores ?? {})).toEqual(["active"]);
  });

  it("查询词包含引号不抛异常（FTS 语法注入防护）", () => {
    insertNote("n1", "普通内容");
    refreshNoteFts(getDb(), "n1");
    expect(() => searchNoteIds('羽毛球" OR "1')).not.toThrow();
  });

  it("refreshNoteFts 对已删除笔记只清除 FTS 行", () => {
    insertNote("n1", "临时内容");
    refreshNoteFts(getDb(), "n1");
    getDb().delete(notes).where(eq(notes.id, "n1")).run();
    expect(() => refreshNoteFts(getDb(), "n1")).not.toThrow();
    const { ids } = searchNoteIds("临时内容");
    expect(ids).toEqual([]);
  });

  it("refreshNoteFts 对回收站笔记只删行不重建", () => {
    insertNote("n1", "量子计算入门", { deletedAt: Date.now() });
    refreshNoteFts(getDb(), "n1");
    expect(searchNoteIds("量子").ids).toEqual([]);
  });

  it("rebuildFtsIfNeeded 以未删除笔记数为基准，重建后不含回收站笔记", () => {
    insertNote("n1", "深度学习笔记");
    insertNote("n2", "量子计算入门", { deletedAt: Date.now() });
    refreshNoteFts(getDb(), "n1");
    // 存活 1 条 == FTS 1 行：判据成立不应重建；若误用全量计数会触发重建并把回收站笔记也建进去
    rebuildFtsIfNeeded(getDb());
    expect(searchNoteIds("量子").ids).toEqual([]);
    // 人为清空制造失步：重建后只含存活笔记
    getSqlite().prepare("DELETE FROM notes_fts").run();
    rebuildFtsIfNeeded(getDb());
    expect(searchNoteIds("深度学习").ids).toEqual(["n1"]);
    expect(searchNoteIds("量子").ids).toEqual([]);
  });

  it("makeExcerpt 围绕命中词截取上下文", () => {
    const content = "开头".repeat(50) + "羽毛球" + "结尾".repeat(50);
    const excerpt = makeExcerpt(content, ["羽毛球"]);
    expect(excerpt).toContain("羽毛球");
    expect(excerpt.length).toBeLessThan(content.length);
  });

  it("makeExcerpt 未命中时返回去除标记的开头片段", () => {
    const excerpt = makeExcerpt("# 标题\n这是一段没有关键词的内容", ["不存在词"]);
    expect(excerpt).toContain("这是一段");
    expect(excerpt).not.toContain("#");
  });
});
