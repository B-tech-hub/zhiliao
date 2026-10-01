import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { createNote } from "@/lib/note-write";
import { wipeData } from "../helpers/db";
import { drainPendingMarkdownExports, restoreTestNotesExportDir, testNotesExportDir } from "../helpers/markdown-export";

beforeEach(() => { wipeData(); restoreTestNotesExportDir(); });
const notePath = (root: string, id: string) => path.join(root, "未分类", `无标题-${id}.md`);

describe("测试 Markdown 导出隔离", () => {
  it("真实创建的延后导出进入安全目录，不写工作目录", async () => {
    const note = createNote(getDb(), { content: "隔离导出正文", deferAi: true });
    await drainPendingMarkdownExports();
    expect(fs.readFileSync(notePath(testNotesExportDir, note.id), "utf8")).toContain("隔离导出正文");
    expect(fs.existsSync(notePath(path.resolve("data/notes"), note.id))).toBe(false);
  });

  it("临时覆盖收尾后恢复安全默认，下一次导出仍隔离", async () => {
    const override = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-notes-override-"));
    try {
      process.env.NOTES_EXPORT_DIR = override;
      const first = createNote(getDb(), { content: "临时目录正文", deferAi: true });
      await drainPendingMarkdownExports();
      expect(fs.readFileSync(notePath(override, first.id), "utf8")).toContain("临时目录正文");
      restoreTestNotesExportDir();
      const second = createNote(getDb(), { content: "恢复默认正文", deferAi: true });
      await drainPendingMarkdownExports();
      expect(fs.existsSync(notePath(testNotesExportDir, second.id))).toBe(true);
      expect(fs.existsSync(notePath(override, second.id))).toBe(false);
      expect(fs.existsSync(notePath(path.resolve("data/notes"), second.id))).toBe(false);
    } finally {
      await drainPendingMarkdownExports();
      restoreTestNotesExportDir();
      fs.rmSync(override, { recursive: true, force: true });
    }
  });
});
