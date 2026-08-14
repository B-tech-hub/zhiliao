import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { getDb } from "@/db";
import {
  buildExportPlan,
  exportZipName,
  renderNoteMarkdown,
  rewriteImageRefs,
  sanitizeEntryName,
} from "@/lib/export";
import { replaceNoteTags } from "@/lib/notes";
import { insertNote, insertTopic, wipeData } from "../helpers/db";

const savedUploadDir = process.env.UPLOAD_DIR;

function restoreUploadDir() {
  if (savedUploadDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = savedUploadDir;
}

// 建一个临时 uploads 目录并放入指定文件名的假图片
function fakeUploads(...filenames: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-export-"));
  for (const f of filenames) fs.writeFileSync(path.join(dir, f), "fake");
  process.env.UPLOAD_DIR = dir;
  return dir;
}

describe("export sanitizeEntryName", () => {
  it("替换 Windows 非法字符与控制字符为下划线", () => {
    expect(sanitizeEntryName('a\\b/c:d*e?f"g<h>i|j', "x")).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(sanitizeEntryName('11' + String.fromCharCode(0, 98, 31) + '12', 'x')).toBe('11_b_12');
  });

  it("去除结尾的点与空格（Windows 解压约束）", () => {
    expect(sanitizeEntryName("笔记...", "x")).toBe("笔记");
    expect(sanitizeEntryName("笔记 . . ", "x")).toBe("笔记");
  });

  it("Windows 保留设备名加前缀，含带扩展名形态", () => {
    expect(sanitizeEntryName("CON", "x")).toBe("_CON");
    expect(sanitizeEntryName("com1.txt", "x")).toBe("_com1.txt");
    expect(sanitizeEntryName("console", "x")).toBe("console");
  });

  it("超长截断为 60 字符，空串与全非法串返回 fallback", () => {
    expect(sanitizeEntryName("啊".repeat(80), "x")).toBe("啊".repeat(60));
    expect(sanitizeEntryName("", "无标题")).toBe("无标题");
    expect(sanitizeEntryName("   ", "无标题")).toBe("无标题");
    expect(sanitizeEntryName("...", "无标题")).toBe("无标题");
  });
});

describe("export renderNoteMarkdown", () => {
  const base = {
    id: "n1",
    title: "标题",
    content: "正文",
    summary: "摘要" as string | null,
    createdAt: Date.UTC(2026, 0, 2, 3, 4, 5),
    updatedAt: Date.UTC(2026, 5, 7, 8, 9, 10),
  };

  it("frontmatter 含 id/title/topic/tags/created/updated/summary，标题含引号冒号时仍为合法 YAML", () => {
    const md = renderNoteMarkdown({ ...base, title: '他说: "你好" #5' }, "主题: A", ["标签\"1\"", "b: c"]);
    const fm = md.split("---")[1];
    const data = parseYaml(fm);
    expect(data).toEqual({
      id: "n1",
      title: '他说: "你好" #5',
      topic: "主题: A",
      tags: ['标签"1"', "b: c"],
      created: "2026-01-02T03:04:05.000Z",
      updated: "2026-06-07T08:09:10.000Z",
      summary: "摘要",
    });
    expect(md.endsWith("正文\n")).toBe(true);
  });

  it("summary 为空时省略该行", () => {
    const md = renderNoteMarkdown({ ...base, summary: null }, "主题", []);
    expect(md).not.toContain("summary:");
    expect(parseYaml(md.split("---")[1]).tags).toEqual([]);
  });
});

describe("export rewriteImageRefs", () => {
  it("同时改写 Markdown 与内嵌 img 两种形态为 ../assets/", () => {
    const src = '看图 ![截图](/api/images/abc123.png)\n<img src="/api/images/def456.webp" width="50%" alt="图">';
    const out = rewriteImageRefs(src);
    expect(out).toContain("![截图](../assets/abc123.png)");
    expect(out).toContain('<img src="../assets/def456.webp"');
    expect(out).not.toContain("/api/images/");
  });

  it("不触碰外链图片", () => {
    const src = "![外](https://example.com/a.png)";
    expect(rewriteImageRefs(src)).toBe(src);
  });
});

describe("export buildExportPlan", () => {
  beforeEach(() => wipeData());
  afterEach(restoreUploadDir);

  it("目录结构为 主题名/标题-id.md，空标题用 无标题-id.md", () => {
    fakeUploads();
    insertTopic("t1", "读书");
    insertNote("n1", "内容一", { topicId: "t1", title: "笔记A" });
    insertNote("n2", "内容二", { topicId: "t1" });
    const plan = buildExportPlan(getDb());
    const paths = plan.mdEntries.map((e) => e.zipPath).sort();
    expect(paths).toEqual(["读书/无标题-n2.md", "读书/笔记A-n1.md"].sort());
  });

  it("主题名 sanitize 后同名时第二个目录加序号后缀", () => {
    fakeUploads();
    insertTopic("t1", "a/b");
    insertTopic("t2", "a:b");
    insertNote("n1", "一", { topicId: "t1", title: "x" });
    insertNote("n2", "二", { topicId: "t2", title: "y" });
    const plan = buildExportPlan(getDb());
    const dirs = new Set(plan.mdEntries.map((e) => e.zipPath.split("/")[0]));
    expect(dirs).toEqual(new Set(["a_b", "a_b-2"]));
  });

  it("不含回收站笔记", () => {
    fakeUploads();
    insertNote("n1", "存活");
    insertNote("n2", "已删", { deletedAt: Date.now() });
    const plan = buildExportPlan(getDb());
    expect(plan.mdEntries.length).toBe(1);
    expect(plan.mdEntries[0].zipPath).toContain("n1");
  });

  it("frontmatter 带标签，正文引用被改写", () => {
    fakeUploads("pic1.png");
    insertNote("n1", "图 ![a](/api/images/pic1.png)");
    replaceNoteTags(getDb(), "n1", ["读书", "摘录"]);
    const plan = buildExportPlan(getDb());
    expect(plan.mdEntries[0].content).toContain('tags: ["摘录", "读书"]');
    expect(plan.mdEntries[0].content).toContain("../assets/pic1.png");
  });

  it("多笔记引用同一图片时 assets 去重，未被引用的图片不打包", () => {
    const dir = fakeUploads("shared.png", "orphan.png");
    insertNote("n1", "![1](/api/images/shared.png)");
    insertNote("n2", '<img src="/api/images/shared.png">');
    const plan = buildExportPlan(getDb());
    expect(plan.assets).toEqual([
      { zipPath: "assets/shared.png", diskPath: path.join(dir, "shared.png") },
    ]);
  });

  it("引用了磁盘缺失的图片时跳过不抛错", () => {
    fakeUploads("exists.png");
    insertNote("n1", "![a](/api/images/exists.png) ![b](/api/images/missing.png)");
    const plan = buildExportPlan(getDb());
    expect(plan.assets.map((a) => a.zipPath)).toEqual(["assets/exists.png"]);
  });

  it("zipPath 全部使用 / 分隔且不以 / 开头", () => {
    fakeUploads("p.png");
    insertTopic("t1", "深度 学习");
    insertNote("n1", "![x](/api/images/p.png)", { topicId: "t1", title: "卷积" });
    const plan = buildExportPlan(getDb());
    for (const p of [...plan.mdEntries.map((e) => e.zipPath), ...plan.assets.map((a) => a.zipPath)]) {
      expect(p).not.toMatch(/\\/);
      expect(p.startsWith("/")).toBe(false);
    }
  });
});

describe("exportZipName", () => {
  it("格式为 zhiliao-export-YYYYMMDD.zip", () => {
    expect(exportZipName(new Date(Date.UTC(2026, 7, 14)))).toBe("zhiliao-export-20260814.zip");
  });
});
