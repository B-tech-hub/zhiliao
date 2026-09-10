/* 用户提供的 130 篇 Markdown 语料验收。默认跳过，避免 CI 依赖本机资料。
   设置 ZHILIAO_CORPUS_DIR 后只运行本文件；数据库沿用 tests/setup.ts 的内存库。
   本地验收禁止网络请求，不能把关键词召回和引用白名单当作真实模型效果。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, getSqlite } from "@/db";
import { aiJobs, conversations, notes, topics } from "@/db/schema";
import { GET as searchRoute } from "@/app/api/search/route";
import { citationsToMarkdown } from "@/components/chat/chat-state";
import { buildNoteChunks } from "@/lib/ai/embedding";
import { buildSystemMessage } from "@/lib/ai/chat-context";
import { buildSourcesContext, setConversationSources } from "@/lib/ai/sources";
import { MAX_TOOL_RESULT_CHARS, runTool } from "@/lib/ai/tools";
import { importZipFile, parseFrontMatter, type ImportReport } from "@/lib/import";
import { getTagsForNotes } from "@/lib/notes";
import { searchNoteIds, segment } from "@/lib/search";
import { wipeData } from "../helpers/db";

const CORPUS_DIR = process.env.ZHILIAO_CORPUS_DIR;
const REPORT_PATH = process.env.ZHILIAO_CORPUS_REPORT;
const ENABLED = Boolean(CORPUS_DIR);
const PUBLIC_DIR = "公开笔记测试集";

interface SourceFile {
  relativePath: string;
  bytes: Buffer;
  hash: string;
}

interface QueryCase {
  query: string;
  prefix: string;
}

// 公开资料的问题取自随包 README，运行失败后不得改写问题来凑通过率。
const QUERY_CASES: QueryCase[] = [
  { query: "Markdown 表格如何设置居中和右对齐？", prefix: "12-" },
  { query: "文档给出的圆面积公式是什么？", prefix: "11-" },
  { query: "CS 自学规划推荐了哪些操作系统课程？", prefix: "13-" },
  { query: "MIT 6.S081 使用什么教学操作系统？它基于哪种指令集？", prefix: "15-" },
  { query: "搜索引擎的工作过程分为哪三个阶段？", prefix: "14-" },
  { query: "弱人工智能与强人工智能有什么区别？", prefix: "16-" },
  { query: "BERT-base 和 BERT-large 分别有多少层？", prefix: "17-" },
  { query: "Transformer 为什么比 RNN 更容易并行化？", prefix: "17-" },
  { query: "负责任人工智能原则包含哪些概念？", prefix: "18-" },
  { query: "FreeRTOS 任务之间有哪些通信方式？", prefix: "10-" },
  { query: "UART SPI I2C 三种通信协议如何选择？", prefix: "09-" },
  { query: "英语六级听力如何提高？", prefix: "06-" },
  { query: "MIT6.050J Information theory Entropy", prefix: "130-" },
];

const evidence: Record<string, unknown> = {
  scope: "130 篇语料的本地导入、关键词搜索、分块保真与来源引用边界",
  realModelCalls: 0,
};
const queryEvidence: Record<string, unknown>[] = [];
const network = vi.fn(() => { throw new Error("本地语料验收不允许网络请求"); });
let tempRoot = "";
let sourceFiles: SourceFile[] = [];
let bodyFiles: SourceFile[] = [];
let firstImport: ImportReport;
let zipPath = "";
let importedNotes: (typeof notes.$inferSelect)[] = [];

const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const drainExports = () => new Promise<void>((resolve) => setImmediate(resolve));

function filesUnder(root: string, relative = ""): string[] {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .flatMap((entry) => {
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`测试资料不接受符号链接：${name}`);
      return entry.isDirectory() ? filesUnder(root, name) : entry.isFile() ? [name] : [];
    }).sort();
}

function sourceFor(prefix: string): SourceFile {
  const matches = bodyFiles.filter((file) => path.posix.basename(file.relativePath).startsWith(prefix));
  expect(matches, `语料编号 ${prefix} 应唯一`).toHaveLength(1);
  return matches[0];
}

function noteFor(prefix: string) {
  const source = sourceFor(prefix);
  const body = parseFrontMatter(source.bytes.toString("utf8")).body.trim();
  const matches = importedNotes.filter((note) => note.content === body);
  expect(matches, `${source.relativePath} 应能对应到唯一笔记`).toHaveLength(1);
  return matches[0];
}

function seedSources(id: string, refs: Parameters<typeof setConversationSources>[2]) {
  const now = Date.now();
  getDb().insert(conversations).values({
    id, scopeType: "sources", scopeId: "", title: "语料验收", createdAt: now, updatedAt: now,
  }).run();
  setConversationSources(getDb(), id, refs);
  return buildSourcesContext(getDb(), id);
}

describe.runIf(ENABLED)("130 篇测试笔记隔离验收", () => {
  beforeAll(async () => {
    // 在任何清库和写库操作之前确认隔离条件。
    expect(process.env.DATABASE_PATH).toBe(":memory:");
    vi.stubEnv("EMBEDDING_BASE_URL", "");
    vi.stubEnv("EMBEDDING_API_KEY", "");
    vi.stubEnv("EMBEDDING_MODEL", "");
    vi.stubGlobal("fetch", network);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-corpus-"));
    vi.stubEnv("UPLOAD_DIR", path.join(tempRoot, "uploads"));
    vi.stubEnv("NOTES_EXPORT_DIR", path.join(tempRoot, "notes"));
    wipeData();

    const root = path.resolve(CORPUS_DIR!);
    sourceFiles = filesUnder(root).map((relativePath) => {
      const bytes = fs.readFileSync(path.join(root, relativePath));
      return { relativePath, bytes, hash: sha256(bytes) };
    });
    bodyFiles = sourceFiles.filter((file) => file.relativePath.endsWith(".md")
      && path.posix.basename(file.relativePath).toLowerCase() !== "readme.md"
      && !file.relativePath.toLowerCase().split("/").includes("licenses"));
    evidence.dataset = {
      noteFiles: bodyFiles.length,
      archiveFiles: sourceFiles.length,
      sha256: sha256(bodyFiles.map((file) => `${file.relativePath}\t${file.hash}`).join("\n")),
      manifest: bodyFiles.map(({ relativePath, hash, bytes }) => ({ path: relativePath, sha256: hash, bytes: bytes.length })),
    };

    zipPath = path.join(tempRoot, "corpus.zip");
    const zip = new ZipFile();
    for (const file of sourceFiles) zip.addBuffer(file.bytes, `测试笔记/${file.relativePath}`);
    const completed = pipeline(zip.outputStream, fs.createWriteStream(zipPath));
    zip.end();
    await completed;
    const start = performance.now();
    firstImport = await importZipFile(getDb(), zipPath, { runAi: false });
    await drainExports();
    importedNotes = getDb().select().from(notes).orderBy(notes.id).all();
    evidence.firstImport = { ...firstImport, elapsedMs: Math.round(performance.now() - start) };
  });

  afterAll(async () => {
    if (!tempRoot) return;
    try {
      await drainExports();
      const unchanged = sourceFiles.every((file) =>
        sha256(fs.readFileSync(path.join(CORPUS_DIR!, file.relativePath))) === file.hash);
      evidence.sourceFilesUnchanged = unchanged;
      evidence.networkRequests = network.mock.calls.length;
      evidence.queries = queryEvidence;
      if (REPORT_PATH) {
        const report = path.resolve(REPORT_PATH);
        fs.mkdirSync(path.dirname(report), { recursive: true });
        fs.writeFileSync(report, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
      }
      expect(unchanged, "原始测试资料应保持不变").toBe(true);
      expect(network).not.toHaveBeenCalled();
    } finally {
      wipeData();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      // 只清理本次创建的临时目录，绝不对语料目录做递归删除。
      const target = path.resolve(tempRoot);
      if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith("zhiliao-corpus-")) {
        throw new Error("临时目录清理范围校验失败");
      }
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("130 篇正文及公开资料清单完整，UTF-8 编码有效", () => {
    expect(bodyFiles).toHaveLength(130);
    expect(new Set(bodyFiles.map((file) => file.hash)).size).toBe(130);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (const file of bodyFiles) expect(decoder.decode(file.bytes).trim(), file.relativePath).not.toBe("");
    const manifest = sourceFiles.find((file) => file.relativePath === `${PUBLIC_DIR}/manifest.jsonl`)!;
    const entries = manifest.bytes.toString("utf8").trim().split(/\r?\n/)
      .map((line) => JSON.parse(line) as { file: string; sha256: string; bytes: number });
    expect(entries).toHaveLength(120);
    for (const entry of entries) {
      const file = sourceFiles.find((item) => item.relativePath === `${PUBLIC_DIR}/${entry.file}`)!;
      expect(file?.hash, entry.file).toBe(entry.sha256);
      expect(file?.bytes.length, entry.file).toBe(entry.bytes);
    }
  });

  it("首次导入 130 条，无失败、无附属说明误入库和模型任务", () => {
    expect(firstImport).toMatchObject({ imported: 130, overwritten: 0, skipped: [], failed: [], images: 0 });
    expect(importedNotes).toHaveLength(130);
    expect(importedNotes.every((note) => note.title.trim() && note.aiStatus === "skipped")).toBe(true);
    expect(getDb().select().from(aiJobs).all()).toHaveLength(0);
    const fts = getSqlite().prepare("SELECT COUNT(*) AS count FROM notes_fts").get() as { count: number };
    expect(fts.count).toBe(130);
  });

  it("所有正文保真，四个主题和代表性标签正确保留", () => {
    const expected = bodyFiles.map((file) => sha256(parseFrontMatter(file.bytes.toString("utf8")).body.trim())).sort();
    expect(importedNotes.map((note) => sha256(note.content)).sort()).toEqual(expected);
    const counts = getSqlite().prepare("SELECT t.name, COUNT(*) AS count FROM notes n JOIN topics t ON t.id = n.topic_id GROUP BY t.name ORDER BY t.name").all();
    evidence.topics = counts;
    expect(counts).toEqual(expect.arrayContaining([
      { name: "考研数学", count: 4 }, { name: "英语六级", count: 3 },
      { name: "嵌入式", count: 3 }, { name: PUBLIC_DIR, count: 120 },
    ]));
    expect(counts).toHaveLength(4);
    const first = noteFor("01-");
    expect(first.title).toBe("考研数学试卷结构与分值分布");
    expect(getTagsForNotes(getDb(), [first.id]).get(first.id)?.sort()).toEqual(["考研", "试卷结构", "分值", "数一", "数二", "数三"].sort());
  });

  it("130 份增量 Markdown 出口保留笔记 ID 与完整正文", () => {
    const root = path.join(tempRoot, "notes");
    const exports = filesUnder(root).filter((name) => name.endsWith(".md"));
    expect(exports).toHaveLength(130);
    for (const name of exports) {
      const { data, body } = parseFrontMatter(fs.readFileSync(path.join(root, name), "utf8"));
      const original = importedNotes.find((note) => note.id === data.id);
      expect(original, name).toBeDefined();
      expect(body.trim(), name).toBe(original!.content);
    }
    evidence.markdownExports = exports.length;
  });

  it("重复导入新增 0 条、跳过 130 条，已有数据和出口数量不变", async () => {
    const before = sha256(JSON.stringify(getDb().select().from(notes).orderBy(notes.id).all()));
    const start = performance.now();
    const second = await importZipFile(getDb(), zipPath, { runAi: false });
    await drainExports();
    evidence.secondImport = { ...second, elapsedMs: Math.round(performance.now() - start) };
    expect(second).toMatchObject({ imported: 0, overwritten: 0, failed: [], images: 0, topicsCreated: [] });
    expect(second.skipped).toHaveLength(130);
    expect(second.skipped.every((item) => item.reason === "已存在")).toBe(true);
    expect(sha256(JSON.stringify(getDb().select().from(notes).orderBy(notes.id).all()))).toBe(before);
    expect(filesUnder(path.join(tempRoot, "notes"))).toHaveLength(130);
  });

  it.each(QUERY_CASES)("搜索页面和助手应在前五条找到来源：$query", async ({ query, prefix }) => {
    const wanted = noteFor(prefix);
    const response = await searchRoute(new NextRequest(`http://localhost/api/search?q=${encodeURIComponent(query)}`));
    const page = await response.json() as { results: { id: string; title: string }[]; vectorEnabled: boolean };
    const tool = await runTool("search_notes", JSON.stringify({ query }), { db: getDb(), userUrls: [] });
    const pageIndex = page.results.findIndex((note) => note.id === wanted.id);
    const toolIndex = (tool.noteIds ?? []).indexOf(wanted.id);
    queryEvidence.push({
      query, expectedFile: sourceFor(prefix).relativePath,
      pageRank: pageIndex < 0 ? null : pageIndex + 1,
      assistantRank: toolIndex < 0 ? null : toolIndex + 1,
      pageTop5: page.results.slice(0, 5).map((note) => note.title),
      assistantTop5: (tool.noteIds ?? []).slice(0, 5).map((id) => importedNotes.find((note) => note.id === id)?.title),
      vectorEnabled: page.vectorEnabled,
    });
    expect(response.status).toBe(200);
    expect(page.vectorEnabled).toBe(false);
    expect.soft(page.results.slice(0, 5).map((note) => note.id), `搜索页面没有在前五条返回 ${sourceFor(prefix).relativePath}`).toContain(wanted.id);
    expect.soft((tool.noteIds ?? []).slice(0, 5), `助手没有在前五条返回 ${sourceFor(prefix).relativePath}`).toContain(wanted.id);
  });

  it("六篇长文的分块覆盖完整正文，包括最末内容", () => {
    const longNotes = importedNotes.filter((note) => note.content.length > 5000);
    expect(longNotes).toHaveLength(6);
    evidence.longNotes = longNotes.map((note) => {
      const chunks = buildNoteChunks(note, { injectTitle: false });
      const compact = (text: string) => text.replace(/\s/g, "");
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.length).toBeLessThanOrEqual(20);
      expect(compact(chunks.join("")), note.title).toBe(compact(note.content));
      return { title: note.title, characters: note.content.length, chunks: chunks.length, contentPreserved: true };
    });
  });

  it("长文末尾能被搜索，跟随续读位置可读到末尾并完整还原正文", async () => {
    const wanted = noteFor("13-");
    // 章节标题在前文也出现过，必须用只存在于末尾正文的原句作证据。
    const tail = "以上的课程规划难免带有强烈的个人偏好";
    expect(wanted.content.indexOf(tail)).toBeGreaterThan(12000);
    expect(wanted.content.indexOf(tail)).toBe(wanted.content.lastIndexOf(tail));
    const context = seedSources("corpus-long", [{ type: "note", id: wanted.id }]);
    const toolContext = { db: getDb(), userUrls: [], allowedNoteIds: new Set(context.allowedNoteIds) };
    const found = await runTool("search_notes", JSON.stringify({ query: tail }), toolContext);
    const pages: { offset: number; nextOffset: number | null; bodyCharacters: number; resultCharacters: number; containsTail: boolean }[] = [];
    let offset: number | null = 0;
    let fullBody = "";
    while (offset !== null && pages.length < 8) {
      const read = await runTool("read_note", JSON.stringify({ noteId: wanted.id, offset }), toolContext);
      expect(read.error).toBeUndefined();
      expect(read.content.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
      const pointer = read.content.match(/^nextOffset: (\d+|null)$/m);
      expect(pointer, "工具必须返回明确的续读位置").not.toBeNull();
      const marker = "\n正文:\n";
      expect(read.content).toContain(marker);
      const body = read.content.slice(read.content.indexOf(marker) + marker.length);
      const nextOffset: number | null = pointer![1] === "null" ? null : Number(pointer![1]);
      if (nextOffset !== null) {
        expect(nextOffset).toBeGreaterThan(offset);
        expect(nextOffset).toBe(offset + body.length);
      }
      pages.push({ offset, nextOffset, bodyCharacters: body.length, resultCharacters: read.content.length, containsTail: body.includes(tail) });
      fullBody += body;
      offset = nextOffset;
    }
    evidence.longSourceRead = {
      mode: context.mode, tailOffset: wanted.content.indexOf(tail),
      searchFound: found.noteIds?.includes(wanted.id),
      pages, readContainsTail: fullBody.includes(tail),
      contentPreserved: fullBody === wanted.content, readComplete: offset === null,
    };
    expect(context.mode).toBe("digest");
    expect(found.noteIds).toContain(wanted.id);
    expect(offset, "有限次续读后应到达正文末尾").toBeNull();
    expect(fullBody, "续读不得遗漏或重复任何正文").toBe(wanted.content);
    expect(fullBody.includes(tail), "来源正文超预算后，read_note 应能提供被检索到的末尾证据").toBe(true);
  });

  it("候选截断诊断：对比原始索引、排序前截断与完整候选", () => {
    const query = QUERY_CASES.find((item) => item.prefix === "17-")!.query;
    const wanted = noteFor("17-");
    const terms = segment(query).split(/\s+/).filter((term) => term && !/^[\p{P}]+$/u.test(term));
    const match = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
    const sqlite = getSqlite();
    const all = sqlite.prepare("SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?").all(match) as { note_id: string }[];
    const limited = sqlite.prepare("SELECT note_id FROM notes_fts WHERE notes_fts MATCH ? LIMIT 50").all(match) as { note_id: string }[];
    const ordered = sqlite.prepare("SELECT note_id FROM notes_fts WHERE notes_fts MATCH ? ORDER BY bm25(notes_fts, 0, 5.0, 1.0, 3.0) LIMIT 50").all(match) as { note_id: string }[];
    const rank = (ids: string[]) => ids.includes(wanted.id) ? ids.indexOf(wanted.id) + 1 : null;
    const small = searchNoteIds(query, 50);
    const large = searchNoteIds(query, 150);
    evidence.searchCandidateProbe = {
      query, matchedNotes: all.length, sourceExistsInFts: all.some((row) => row.note_id === wanted.id),
      sourceInUnsorted50: limited.some((row) => row.note_id === wanted.id),
      sourceInBm25Sorted50: ordered.some((row) => row.note_id === wanted.id),
      rankWith50Candidates: rank(small.ids), rankWith150Candidates: rank(large.ids),
    };
    expect(all.some((row) => row.note_id === wanted.id), "原笔记必须确实存在于全文索引").toBe(true);
    expect(small.ids[0], "50 个候选也应召回并正确排列目标笔记").toBe(wanted.id);
    expect(large.ids).toContain(wanted.id);

    const formula = noteFor("11-");
    const originalQuery = QUERY_CASES.find((item) => item.prefix === "11-")!.query;
    evidence.formulaQueryProbe = [originalQuery, "圆面积公式", "圆的面积"].map((text) => {
      const result = searchNoteIds(text, 150);
      const index = result.ids.indexOf(formula.id);
      return { query: text, rank: index < 0 ? null : index + 1, terms: result.terms };
    });
  });

  it("来源内能读到真实 BERT 证据，来源外读取和伪造引用被拦截", async () => {
    const bert = noteFor("17-");
    const outside = noteFor("01-");
    const context = seedSources("corpus-citation", [{ type: "note", id: bert.id }]);
    const toolContext = { db: getDb(), userUrls: [], allowedNoteIds: new Set(context.allowedNoteIds) };
    const search = await runTool("search_notes", JSON.stringify({ query: "BERT" }), toolContext);
    const read = await runTool("read_note", JSON.stringify({ noteId: bert.id }), toolContext);
    expect(search.noteIds).toEqual([bert.id]);
    expect(read.error).toBeUndefined();
    expect(read.content).toContain("有12层");
    expect(read.content).toContain("有24层");
    const denied = await runTool("read_note", JSON.stringify({ noteId: outside.id }), toolContext);
    expect(denied.error).toBe(true);
    expect(denied.content).toContain("不在本次对话的来源集内");
    const formatted = citationsToMarkdown(`来源[^${bert.id}]，越界[^${outside.id}]，伪造[^corpus-missing]`, new Set(context.allowedNoteIds));
    expect(formatted).toContain(`(/notes/${bert.id})`);
    expect(formatted).not.toContain(`(/notes/${outside.id})`);
    expect(formatted).not.toContain("(/notes/corpus-missing)");
    evidence.citations = { validLink: true, outsideDenied: true, inventedLinkBlocked: true };
  });

  it("公开资料主题展开为 120 个来源，来源空集和无关关键词不越界", async () => {
    const topic = getDb().select().from(topics).where(eq(topics.name, PUBLIC_DIR)).get()!;
    const context = seedSources("corpus-topic", [{ type: "topic", id: topic.id }]);
    expect(context.allowedNoteIds).toHaveLength(120);
    expect(context.mode).toBe("digest");
    const missing = await runTool("search_notes", JSON.stringify({ query: "新能源汽车" }), {
      db: getDb(), userUrls: [], allowedNoteIds: new Set(context.allowedNoteIds),
    });
    expect(missing.noteIds).toEqual([]);
    const empty = await runTool("search_notes", JSON.stringify({ query: "BERT" }), {
      db: getDb(), userUrls: [], allowedNoteIds: new Set<string>(),
    });
    expect(empty.noteIds).toEqual([]);
    const system = buildSystemMessage("sources", "", "corpus-topic");
    expect(system.system).toContain("来源笔记中没有相关内容");
    evidence.sources = { count: context.allowedNoteIds.length, mode: context.mode, contextCharacters: context.context.length, noAnswerQueryEmpty: true, emptyScopeDenied: true };
  });
});
