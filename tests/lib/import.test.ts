import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ZipFile } from "yazl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { aiJobs, images, notes, topics } from "@/db/schema";
import { buildExportPlan } from "@/lib/export";
import { ImportError, importZipFile, isSafeEntryPath, parseFrontMatter, restoreImageRefs } from "@/lib/import";
import { getTagsForNotes, replaceNoteTags } from "@/lib/notes";
import { insertNote, insertTopic, wipeData } from "../helpers/db";

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

// sniffImageMime 只看头几个字节，够用即可
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16)]);
const HEIC = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic", "ascii"), Buffer.alloc(16)]);

function makeZip(entries: { name: string; content: Buffer | string }[]): Promise<string> {
  const file = path.join(tempDir("zhiliao-zip-"), "in.zip");
  const zip = new ZipFile();
  for (const e of entries) {
    zip.addBuffer(Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content, "utf8"), e.name);
  }
  zip.end();
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    zip.outputStream.pipe(out);
    out.on("close", () => resolve(file));
    out.on("error", reject);
  });
}

// 把当前库的导出计划打成 zip，供往返测试使用
async function exportToZip(): Promise<string> {
  const plan = buildExportPlan(getDb());
  return makeZip([
    ...plan.mdEntries.map((e) => ({ name: e.zipPath, content: e.content })),
    ...plan.assets.map((a) => ({ name: a.zipPath, content: fs.readFileSync(a.diskPath) })),
  ]);
}

/* 造一个带路径穿越的包。yazl 自己就拒写非法条目名，所以只能先写合法名，
   再在字节层面等长替换——长度一致，本地头与中央目录里的偏移量都不受影响。
   现实中的攻击包正是别人用别的工具造出来的，我们必须能挡住。 */
async function makeUnsafeZip(entries: { name: string; content: string }[], from: string, to: string): Promise<string> {
  if (from.length !== to.length) throw new Error("替换前后长度必须一致");
  const file = await makeZip(entries);
  const buf = fs.readFileSync(file);
  const patched = Buffer.from(buf.toString("latin1").replaceAll(from, to), "latin1");
  fs.writeFileSync(file, patched);
  return file;
}

beforeEach(() => {
  wipeData();
  process.env.UPLOAD_DIR = tempDir("zhiliao-uploads-");
  process.env.NOTES_EXPORT_DIR = tempDir("zhiliao-notes-");
});

afterEach(() => {
  wipeData();
  delete process.env.UPLOAD_DIR;
  delete process.env.NOTES_EXPORT_DIR;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("import isSafeEntryPath", () => {
  it("放行正常的导出路径", () => {
    expect(isSafeEntryPath("读书/笔记A-abc123.md")).toBe(true);
    expect(isSafeEntryPath("assets/pic.png")).toBe(true);
    expect(isSafeEntryPath("assets/originals/pic.heic")).toBe(true);
  });

  it("拒绝路径穿越、绝对路径与盘符", () => {
    expect(isSafeEntryPath("../etc/passwd")).toBe(false);
    expect(isSafeEntryPath("a/../../b.md")).toBe(false);
    expect(isSafeEntryPath("/etc/passwd")).toBe(false);
    expect(isSafeEntryPath("C:/Windows/x.md")).toBe(false);
    expect(isSafeEntryPath("a\\..\\b.md")).toBe(false);
  });

  it("拒绝控制字符与超长路径", () => {
    expect(isSafeEntryPath(`a${String.fromCharCode(0)}b.md`)).toBe(false);
    expect(isSafeEntryPath(`a${String.fromCharCode(10)}b.md`)).toBe(false);
    expect(isSafeEntryPath(`${"a".repeat(513)}.md`)).toBe(false);
    expect(isSafeEntryPath("")).toBe(false);
  });
});

describe("import parseFrontMatter", () => {
  it("解析出 front-matter 并剥掉它，正文不带头部", () => {
    const { data, body } = parseFrontMatter('---\nid: "n1"\ntitle: "标题"\ntags: ["a", "b"]\n---\n\n正文第一行\n');
    expect(data).toMatchObject({ id: "n1", title: "标题", tags: ["a", "b"] });
    expect(body).toBe("\n正文第一行\n");
  });

  it("CRLF 与 BOM 都能吃下", () => {
    const { data, body } = parseFrontMatter('﻿---\r\nid: "n1"\r\n---\r\n正文\r\n');
    expect(data).toMatchObject({ id: "n1" });
    expect(body).toBe("正文\r\n");
  });

  it("没有 front-matter 时整篇是正文", () => {
    const raw = "# 标题\n\n正文";
    expect(parseFrontMatter(raw)).toEqual({ data: {}, body: raw });
  });

  it("front-matter 不是合法 YAML 时退回整篇当正文，而不是丢掉这篇", () => {
    const raw = "---\n这里: 不是: 合法: YAML\n---\n正文";
    const { data, body } = parseFrontMatter(raw);
    expect(data).toEqual({});
    expect(body).toBe(raw);
  });
});

describe("import restoreImageRefs", () => {
  it("按映射把 ../assets/ 换回应用内 URL，Markdown 与 img 两种形态都覆盖", () => {
    const map = new Map([["old.png", "/api/images/new.png"]]);
    const src = '![图](../assets/old.png) <img src="../assets/old.png">';
    expect(restoreImageRefs(src, map)).toBe('![图](/api/images/new.png) <img src="/api/images/new.png">');
  });

  it("映射不上的原样保留，外链不受影响", () => {
    const map = new Map([["a.png", "/api/images/x.png"]]);
    expect(restoreImageRefs("![b](../assets/b.png)", map)).toBe("![b](../assets/b.png)");
    expect(restoreImageRefs("![n](https://e.com/a.png)", map)).toBe("![n](https://e.com/a.png)");
  });

  it("文件名被 URL 编码过也能对上", () => {
    const map = new Map([["中 文.png", "/api/images/x.png"]]);
    expect(restoreImageRefs("![a](../assets/%E4%B8%AD%20%E6%96%87.png)", map)).toBe("![a](/api/images/x.png)");
  });
});

describe("import 往返", () => {
  it("普通 Markdown 从一级标题与所在目录推断标题和主题", async () => {
    const zipPath = await makeZip([
      { name: "公开笔记测试集/计算机科学.md", content: "# 计算机科学自学规划\n\n从基础课程开始。\n" },
    ]);

    const report = await importZipFile(getDb(), zipPath);

    expect(report).toMatchObject({ imported: 1, skipped: [], failed: [], topicsCreated: ["公开笔记测试集"] });
    const note = getDb().select().from(notes).all()[0];
    expect(note.title).toBe("计算机科学自学规划");
    const topic = getDb().select().from(topics).where(eq(topics.id, note.topicId)).get();
    expect(topic?.name).toBe("公开笔记测试集");
  });

  it("普通 Markdown 把 category 映射为主题", async () => {
    const zipPath = await makeZip([
      {
        name: "测试笔记/考研数学.md",
        content: "---\ntitle: 极限计算\ncategory: 考研数学\ntags: [高等数学, 极限]\n---\n\n正文\n",
      },
    ]);

    const report = await importZipFile(getDb(), zipPath);

    expect(report.topicsCreated).toEqual(["考研数学"]);
    const note = getDb().select().from(notes).all()[0];
    const topic = getDb().select().from(topics).where(eq(topics.id, note.topicId)).get();
    expect(topic?.name).toBe("考研数学");
    expect([...(getTagsForNotes(getDb(), [note.id]).get(note.id) ?? [])].sort()).toEqual(["极限", "高等数学"]);
  });

  it("普通 Markdown 没有标题字段和一级标题时使用文件名", async () => {
    const zipPath = await makeZip([{ name: "未分类资料.md", content: "只有正文，没有标题。\n" }]);

    await importZipFile(getDb(), zipPath);

    expect(getDb().select().from(notes).all()[0].title).toBe("未分类资料");
  });

  it("多层目录中的普通 Markdown 使用直接父目录作为主题", async () => {
    const zipPath = await makeZip([
      { name: "测试笔记/公开笔记测试集/信息检索.md", content: "# 信息检索\n\n正文\n" },
    ]);

    await importZipFile(getDb(), zipPath);

    const note = getDb().select().from(notes).all()[0];
    const topic = getDb().select().from(topics).where(eq(topics.id, note.topicId)).get();
    expect(topic?.name).toBe("公开笔记测试集");
  });

  it("普通 Markdown 导入忽略说明文件和许可证目录", async () => {
    const zipPath = await makeZip([
      { name: "测试笔记/正文.md", content: "# 正文\n\n知识内容\n" },
      { name: "测试笔记/README.md", content: "# 数据集说明\n" },
      { name: "测试笔记/licenses/许可.md", content: "# 许可证\n" },
    ]);

    const report = await importZipFile(getDb(), zipPath);

    expect(report.imported).toBe(1);
    expect(getDb().select().from(notes).all().map((note) => note.title)).toEqual(["正文"]);
  });

  it("没有 id 的普通 Markdown 重复导入时不会产生副本", async () => {
    const zipPath = await makeZip([{ name: "资料/检索.md", content: "# 信息检索\n\n搜索引擎分为抓取、索引和排序。\n" }]);

    const first = await importZipFile(getDb(), zipPath);
    const second = await importZipFile(getDb(), zipPath);

    expect(first.imported).toBe(1);
    expect(second).toMatchObject({ imported: 0, skipped: [{ path: "资料/检索.md", reason: "已存在" }] });
    expect(getDb().select().from(notes).all()).toHaveLength(1);
  });

  it("导出再导入，笔记、主题、标签、时间戳与摘要原样还原", async () => {
    insertTopic("t1", "读书");
    const created = Date.UTC(2025, 2, 3, 4, 5, 6);
    const updated = Date.UTC(2025, 6, 8, 9, 10, 11);
    insertNote("n1", "第一条正文", { topicId: "t1", title: "笔记甲", summary: "一句话摘要", createdAt: created, updatedAt: updated });
    insertNote("n2", "第二条正文", { title: "笔记乙" });
    replaceNoteTags(getDb(), "n1", ["摘录", "读书"]);

    const zipPath = await exportToZip();
    wipeData();
    const report = await importZipFile(getDb(), zipPath);

    expect(report.imported).toBe(2);
    expect(report.failed).toEqual([]);
    expect(report.topicsCreated).toEqual(["读书"]);

    const n1 = getDb().select().from(notes).where(eq(notes.id, "n1")).get();
    expect(n1?.title).toBe("笔记甲");
    expect(n1?.content).toBe("第一条正文");
    expect(n1?.summary).toBe("一句话摘要");
    expect(n1?.createdAt).toBe(created);
    expect(n1?.updatedAt).toBe(updated);
    expect([...(getTagsForNotes(getDb(), ["n1"]).get("n1") ?? [])].sort()).toEqual(["摘录", "读书"]);

    const topic = getDb().select().from(topics).where(eq(topics.id, n1!.topicId)).get();
    expect(topic?.name).toBe("读书");

    // 未分类的笔记回到未分类，且主题不加锁——将来 AI 还能替它归类
    const n2 = getDb().select().from(notes).where(eq(notes.id, "n2")).get();
    expect(n2?.topicId).toBe("inbox");
    expect(n2?.topicLocked).toBe(0);
    // front-matter 带了标题，所以标题锁上，AI 不会覆盖
    expect(n2?.titleLocked).toBe(1);
  });

  it("图片重新落盘并拿到新文件名，正文引用指向新 URL", async () => {
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR!, "pic.png"), PNG);
    insertNote("n1", "看图 ![截图](/api/images/pic.png)");
    getDb().insert(images).values({ id: "i1", filename: "pic.png", mime: "image/png", size: PNG.length, createdAt: Date.now() }).run();

    const zipPath = await exportToZip();
    wipeData();
    const report = await importZipFile(getDb(), zipPath);

    expect(report.images).toBe(1);
    const content = getDb().select().from(notes).where(eq(notes.id, "n1")).get()?.content ?? "";
    const m = /\/api\/images\/([\w.-]+)/.exec(content);
    expect(m).not.toBeNull();
    // 文件名换成了新 id，但文件确实躺在 uploads 里，且 images 表有记录
    expect(m![1]).not.toBe("pic.png");
    expect(fs.existsSync(path.join(process.env.UPLOAD_DIR!, m![1]))).toBe(true);
    expect(getDb().select().from(images).where(eq(images.filename, m![1])).get()).toBeTruthy();
  });

  it("HEIC 原件与展示副本成对落库，原件不会变成孤儿", async () => {
    const zipPath = await makeZip([
      { name: "读书/笔记-n1.md", content: '---\nid: "n1"\ntitle: "带图"\n---\n\n![图](../assets/a.jpg)\n' },
      { name: "assets/a.jpg", content: JPEG },
      { name: "assets/originals/a.heic", content: HEIC },
    ]);
    const report = await importZipFile(getDb(), zipPath);

    expect(report.images).toBe(1);
    const img = getDb().select().from(images).all()[0];
    expect(img.mime).toBe("image/jpeg");
    expect(img.originalMime).toBe("image/heic");
    expect(img.originalFilename).toBe(`${img.id}.heic`);
    expect(fs.existsSync(path.join(process.env.UPLOAD_DIR!, img.originalFilename!))).toBe(true);
  });
});

describe("import 判重与覆盖", () => {
  it("同一个包导两次，第二次全部跳过、不产生副本", async () => {
    insertNote("n1", "正文", { title: "甲" });
    const zipPath = await exportToZip();
    wipeData();

    expect((await importZipFile(getDb(), zipPath)).imported).toBe(1);
    const second = await importZipFile(getDb(), zipPath);
    expect(second.imported).toBe(0);
    expect(second.skipped).toEqual([{ path: "未分类/甲-n1.md", reason: "已存在" }]);
    expect(getDb().select().from(notes).all().length).toBe(1);
  });

  /* 真实往返验收抓到的：先存图后写笔记时，重复导入会一次次复制全部图片。
     那些图没有任何笔记引用，要等孤儿清扫过了 24 小时宽限期才回收。 */
  it("重复导入不再复制图片：笔记被跳过时，它引用的图一张也不解压", async () => {
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR!, "pic.png"), PNG);
    insertNote("n1", "![图](/api/images/pic.png)");
    getDb().insert(images).values({ id: "i1", filename: "pic.png", mime: "image/png", size: PNG.length, createdAt: Date.now() }).run();
    const zipPath = await exportToZip();
    wipeData();

    expect((await importZipFile(getDb(), zipPath)).images).toBe(1);
    const second = await importZipFile(getDb(), zipPath);
    expect(second.skipped.length).toBe(1);
    expect(second.images).toBe(0);
    expect(getDb().select().from(images).all().length).toBe(1);
  });

  it("包里带了没有任何笔记引用的图时，不落盘也不入库", async () => {
    const zipPath = await makeZip([
      { name: "读书/笔记-n1.md", content: '---\nid: "n1"\ntitle: "甲"\n---\n没有图的正文' },
      { name: "assets/unused.png", content: PNG },
    ]);
    const report = await importZipFile(getDb(), zipPath);
    expect(report.imported).toBe(1);
    expect(report.images).toBe(0);
    expect(getDb().select().from(images).all()).toEqual([]);
  });

  it("回收站里的同 id 笔记也算已存在，跳过时点明", async () => {
    insertNote("n1", "正文", { title: "甲" });
    const zipPath = await exportToZip();
    getDb().update(notes).set({ deletedAt: Date.now() }).where(eq(notes.id, "n1")).run();

    const report = await importZipFile(getDb(), zipPath);
    expect(report.skipped[0].reason).toBe("已存在（在回收站里）");
  });

  it("overwrite 时用包里的内容覆盖，并把旧向量清空", async () => {
    insertNote("n1", "旧正文", { title: "甲" });
    const zipPath = await exportToZip();
    getDb()
      .update(notes)
      .set({ content: "本地改过的正文", embedding: Buffer.from([1, 2, 3]), embeddingModel: "m", embeddingDim: 3, embeddingChunkCount: 1 })
      .where(eq(notes.id, "n1"))
      .run();

    const report = await importZipFile(getDb(), zipPath, { overwrite: true });
    expect(report.overwritten).toBe(1);
    const n1 = getDb().select().from(notes).where(eq(notes.id, "n1")).get();
    expect(n1?.content).toBe("旧正文");
    // 正文换了，旧向量必然对不上，留着会让这条笔记带着上一版语义参与检索
    expect(n1?.embedding).toBeNull();
    expect(n1?.embeddingModel).toBeNull();
    expect(n1?.embeddingChunkCount).toBeNull();
  });
});

describe("import 不可信输入", () => {
  it("含路径穿越的包整包拒绝，一条也不落库", async () => {
    const zipPath = await makeUnsafeZip(
      [
        { name: "读书/正常-n1.md", content: '---\nid: "n1"\n---\n正文' },
        { name: "xx/evil.md", content: "坏东西" },
      ],
      "xx/evil.md",
      "../evil.md",
    );
    await expect(importZipFile(getDb(), zipPath)).rejects.toThrow(ImportError);
    expect(getDb().select().from(notes).all().length).toBe(0);
  });

  it("不是 zip 的文件给出可读的错误", async () => {
    const file = path.join(tempDir("zhiliao-bad-"), "x.zip");
    fs.writeFileSync(file, "这不是压缩包");
    await expect(importZipFile(getDb(), file)).rejects.toThrow(ImportError);
  });

  it("被引用的 assets 不是图片时只记 failed，不影响笔记导入", async () => {
    const zipPath = await makeZip([
      { name: "读书/笔记-n1.md", content: '---\nid: "n1"\ntitle: "甲"\n---\n![图](../assets/evil.png)' },
      { name: "assets/evil.png", content: "其实是文本" },
    ]);
    const report = await importZipFile(getDb(), zipPath);
    expect(report.imported).toBe(1);
    expect(report.images).toBe(0);
    expect(report.failed).toEqual([{ path: "assets/evil.png", reason: "不是受支持的图片格式" }]);
  });

  it("id 不合法时另发一个，不把来源里的怪字符带进主键", async () => {
    const zipPath = await makeZip([{ name: "读书/x.md", content: '---\nid: "../../坏 id"\ntitle: "甲"\n---\n正文' }]);
    const report = await importZipFile(getDb(), zipPath);
    expect(report.imported).toBe(1);
    expect(getDb().select().from(notes).all()[0].id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("import 与 AI 流水线", () => {
  it("默认不跑整理：状态置 skipped，不入队 note_process", async () => {
    const zipPath = await makeZip([{ name: "读书/笔记-n1.md", content: '---\nid: "n1"\ntitle: "甲"\n---\n正文' }]);
    await importZipFile(getDb(), zipPath);

    // pending 会被 trash.ts 的每日清扫当成中断任务重新入队，等于绕开用户没勾的开关
    expect(getDb().select().from(notes).where(eq(notes.id, "n1")).get()?.aiStatus).toBe("skipped");
    expect(getDb().select().from(aiJobs).where(eq(aiJobs.type, "note_process")).all()).toEqual([]);
  });

  it("缺 updated 时退回 created，不把旧笔记的更新时间抹平成导入当天", async () => {
    const zipPath = await makeZip([
      { name: "读书/x.md", content: '---\nid: "n1"\ntitle: "甲"\ncreated: 2024-05-06T07:08:09.000Z\n---\n正文' },
    ]);
    await importZipFile(getDb(), zipPath);
    const n1 = getDb().select().from(notes).where(eq(notes.id, "n1")).get();
    expect(n1?.createdAt).toBe(Date.UTC(2024, 4, 6, 7, 8, 9));
    expect(n1?.updatedAt).toBe(n1?.createdAt);
  });

  it("正文为空的条目跳过而不是写一条空笔记", async () => {
    const zipPath = await makeZip([{ name: "读书/x.md", content: '---\nid: "n1"\ntitle: "甲"\n---\n\n   \n' }]);
    const report = await importZipFile(getDb(), zipPath);
    expect(report.imported).toBe(0);
    expect(report.skipped[0].reason).toBe("正文为空");
  });
});
