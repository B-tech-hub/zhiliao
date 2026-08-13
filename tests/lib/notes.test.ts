import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { aiJobs, tags } from "@/db/schema";
import { enqueueNoteProcess, getTagsForNotes, replaceNoteTags } from "@/lib/notes";
import { insertNote, wipeData } from "../helpers/db";

describe("notes", () => {
  beforeEach(() => wipeData());

  it("replaceNoteTags 去空白、去重并截断到 10 个", () => {
    insertNote("n1", "内容");
    const names = [" 重复 ", "重复", "", ...Array.from({ length: 12 }, (_, i) => `标签${i}`)];
    replaceNoteTags(getDb(), "n1", names);
    const got = getTagsForNotes(getDb(), ["n1"]).get("n1") ?? [];
    expect(got.length).toBe(10);
    expect(got.filter((t) => t === "重复").length).toBe(1);
  });

  it("replaceNoteTags 复用已有同名标签，不重复建行", () => {
    insertNote("n1", "内容一");
    insertNote("n2", "内容二");
    replaceNoteTags(getDb(), "n1", ["共享标签"]);
    replaceNoteTags(getDb(), "n2", ["共享标签"]);
    const rows = getDb().select().from(tags).where(eq(tags.name, "共享标签")).all();
    expect(rows.length).toBe(1);
  });

  it("replaceNoteTags 全量替换旧标签", () => {
    insertNote("n1", "内容");
    replaceNoteTags(getDb(), "n1", ["旧标签"]);
    replaceNoteTags(getDb(), "n1", ["新标签"]);
    const got = getTagsForNotes(getDb(), ["n1"]).get("n1") ?? [];
    expect(got).toEqual(["新标签"]);
  });

  it("enqueueNoteProcess 对同一笔记的未完成任务只刷新不新增", () => {
    insertNote("n1", "内容");
    enqueueNoteProcess(getDb(), "n1");
    // 模拟任务已退避到未来且带失败记录
    getDb()
      .update(aiJobs)
      .set({ attempts: 2, runAfter: Date.now() + 999_999, lastError: "上次失败" })
      .run();
    enqueueNoteProcess(getDb(), "n1");
    const jobs = getDb().select().from(aiJobs).all();
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe("pending");
    expect(jobs[0].attempts).toBe(0);
    expect(jobs[0].lastError).toBeNull();
    expect(jobs[0].runAfter).toBeLessThanOrEqual(Date.now());
  });

  it("enqueueNoteProcess 对不同笔记各建一条任务", () => {
    insertNote("n1", "内容一");
    insertNote("n2", "内容二");
    enqueueNoteProcess(getDb(), "n1");
    enqueueNoteProcess(getDb(), "n2");
    expect(getDb().select().from(aiJobs).where(eq(aiJobs.type, "note_process")).all().length).toBe(2);
  });
});
