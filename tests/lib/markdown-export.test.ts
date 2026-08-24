import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { createNote, updateNote } from "@/lib/note-write";
import { exportNoteMarkdown } from "@/lib/markdown-export";
import { insertTopic, wipeData } from "../helpers/db";

const dirs: string[] = [];
afterEach(() => { wipeData(); delete process.env.NOTES_EXPORT_DIR; for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("markdown export", () => {
  it("writes frontmatter and removes old title path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-export-")); dirs.push(dir);
    process.env.NOTES_EXPORT_DIR = dir;
    insertTopic("work", "工作/主题");
    const note = createNote(getDb(), { content: "正文", topicId: "work", deferAi: true });
    updateNote(getDb(), note.id, { title: "第一版" });
    exportNoteMarkdown(getDb(), note.id);
    const oldPath = path.join(dir, "工作_主题", `第一版-${note.id}.md`);
    expect(fs.readFileSync(oldPath, "utf8")).toContain("title: \"第一版\"");
    updateNote(getDb(), note.id, { title: "第二版" });
    exportNoteMarkdown(getDb(), note.id);
    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(path.join(dir, "工作_主题", `第二版-${note.id}.md`))).toBe(true);
  });
});
