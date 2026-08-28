/* Markdown zip 导入：既能吃回 /api/export 导出的包，也接收普通 Markdown。
   自家包与导出严格互为逆运算；普通 Markdown 从 front-matter、一级标题、
   文件名与直接父目录推断元数据，没有 id 时用内容指纹防止重复导入。

   zip 是不可信输入。条目名的校验、条目数与体积的上限都必须挡在这一层，
   下游的 saveImage / writeImportedNote 只负责写，不负责防。 */

import { createHash } from "node:crypto";
import yauzl from "yauzl";
import { parse as parseYaml } from "yaml";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { INBOX_TOPIC_ID, notes, topics } from "@/db/schema";
import { newId } from "@/lib/ids";
import { writeImportedNote, type ImportedNote } from "@/lib/note-write";
import { HEIC_MIMES, IMAGE_EXT_BY_MIME, saveImage, sniffImageMime } from "@/lib/uploads";

// 条目数与总体积上限。中央目录声明的大小可以撒谎，读取时另有逐条兜底
const MAX_ENTRIES = 5000;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
const MAX_MD_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
// 单条笔记最多带 50 个标签进来；replaceNoteTags 自己还会再截到 10，
// 这一层挡的是恶意包用十万项数组把导入拖死
const MAX_TAGS = 50;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export class ImportError extends Error {}

export interface ImportOptions {
  // 同 id 的笔记已存在时用包里的内容覆盖；默认跳过
  overwrite?: boolean;
  // 导入后交给 AI 整理（选主题 / 起标题 / 提标签 / 写摘要）；默认不跑
  runAi?: boolean;
}

export interface ImportReport {
  imported: number;
  overwritten: number;
  skipped: { path: string; reason: string }[];
  failed: { path: string; reason: string }[];
  images: number;
  topicsCreated: string[];
}

/* zip 条目名安全校验。绝对路径、盘符、.. 段、反斜杠、控制字符一律拒绝——
   正常导出不会产生这些，出现即视为构造过的包。 */
export function isSafeEntryPath(name: string): boolean {
  if (!name || name.length > 512) return false;
  // 控制字符（含 NUL）按码点判断，不写成字符类——源码里塞裸控制字符太脆
  if (name.split("").some((c) => c.charCodeAt(0) < 0x20)) return false;
  if (name.startsWith("/") || name.startsWith("\\")) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  // zip 规范用 / 分隔，反斜杠在 Windows 上会被当成目录分隔符
  if (name.includes("\\")) return false;
  const segs = name.split("/");
  return segs.every((s, i) => s !== "." && s !== ".." && (s !== "" || i === segs.length - 1));
}

/* 拆 front-matter。解析失败时把整篇当正文而不是报错：外来 Markdown
   常带各家自己的、不合 YAML 的头部，为此丢掉一整篇笔记不划算。 */
export function parseFrontMatter(raw: string): { data: Record<string, unknown>; body: string } {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { data: {}, body: text };
  let parsed: unknown;
  try {
    parsed = parseYaml(m[1]);
  } catch {
    return { data: {}, body: text };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { data: {}, body: text };
  return { data: parsed as Record<string, unknown>, body: text.slice(m[0].length) };
}

/* 正文里引用到的包内图片名。与 restoreImageRefs 用同一条正则，
   两者必须同进同退——一个认得出、另一个认不出，图就会丢。 */
const ASSET_REF = /(?:\.\.\/)?assets\/([^\s)"'\]<>]+)/g;

export function collectAssetRefs(content: string): Set<string> {
  const out = new Set<string>();
  for (const m of content.matchAll(ASSET_REF)) {
    out.add(m[1]);
    try {
      out.add(decodeURIComponent(m[1]));
    } catch {
      /* 名字里有孤立的 % 时只留原样 */
    }
  }
  return out;
}

/* 把包内图片路径还原成应用内的 URL。落盘时文件名会换成新 id，
   所以只能靠「包内旧文件名 → 新 URL」的映射逐个替换，
   映射不上的原样保留（可能是外链，也可能是包里压根没带的图）。 */
export function restoreImageRefs(content: string, urlByAsset: Map<string, string>): string {
  return content.replace(ASSET_REF, (whole, name: string) => {
    let key = name;
    try {
      key = decodeURIComponent(name);
    } catch {
      /* 名字里有孤立的 % 时按原样查 */
    }
    return urlByAsset.get(key) ?? urlByAsset.get(name) ?? whole;
  });
}

// front-matter 的时间值：yaml 会把不加引号的 ISO 串解析成 Date，字符串与秒/毫秒数字也认
function toTimestamp(value: unknown, fallback: number): number {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : Math.round(value * 1000);
  }
  if (typeof value === "string") {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return t;
  }
  return fallback;
}

function toTags(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.slice(0, MAX_TAGS)
    : typeof value === "string"
      ? value.split(/[,，]/).slice(0, MAX_TAGS)
      : [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" && typeof item !== "number") continue;
    const s = String(item).trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstLevelOneHeading(body: string): string {
  return /^#\s+(.+?)\s*$/m.exec(body)?.[1].trim() ?? "";
}

// 主题按名字找，没有就建。扁平一层，目录来源只取 Markdown 的直接父目录
function resolveTopicId(db: DB, name: string, created: string[], cache: Map<string, string>): string {
  const clean = name.trim().slice(0, 50);
  if (!clean) return INBOX_TOPIC_ID;
  const hit = cache.get(clean);
  if (hit) return hit;
  const existing = db.select({ id: topics.id }).from(topics).where(eq(topics.name, clean)).get();
  if (existing) {
    cache.set(clean, existing.id);
    return existing.id;
  }
  const id = newId();
  const now = Date.now();
  db.insert(topics).values({ id, name: clean, createdAt: now, updatedAt: now }).run();
  cache.set(clean, id);
  created.push(clean);
  return id;
}

function openZip(filePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) reject(new ImportError("这个文件不是有效的 zip 压缩包"));
      else resolve(zip);
    });
  });
}

/* 先把全部条目对象收齐再逐个解压。yauzl 的 lazyEntries 只保证顺序读出元信息，
   而条目对象拿到手后可以任意顺序 openReadStream——图片必须先落盘拿到新文件名，
   笔记正文才能改写引用，两者的先后靠这一步解耦，不靠包内的排列顺序。 */
function listEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const out: yauzl.Entry[] = [];
    zip.on("entry", (entry: yauzl.Entry) => {
      out.push(entry);
      zip.readEntry();
    });
    zip.on("end", () => resolve(out));
    zip.on("error", (e) => reject(new ImportError(`读取压缩包失败：${e.message}`)));
    zip.readEntry();
  });
}

function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(new ImportError(`无法读取 ${entry.fileName}`));
      const chunks: Buffer[] = [];
      let total = 0;
      stream.on("data", (chunk: Buffer) => {
        total += chunk.length;
        // 真实读入的字节才是准的，中央目录里声明的大小挡不住压缩炸弹
        if (total > maxBytes) {
          stream.destroy();
          reject(new ImportError(`${entry.fileName} 超过单个文件大小上限`));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("error", () => reject(new ImportError(`读取 ${entry.fileName} 时出错`)));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

const ASSET_PREFIX = "assets/";
const ORIGINAL_PREFIX = "assets/originals/";

function stemOf(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function isImportableMarkdownPath(name: string): boolean {
  const segments = name.toLowerCase().split("/");
  const filename = segments[segments.length - 1];
  return filename.endsWith(".md") && filename !== "readme.md" && !segments.includes("licenses");
}

export async function importZipFile(db: DB, zipPath: string, opts: ImportOptions = {}): Promise<ImportReport> {
  const report: ImportReport = {
    imported: 0,
    overwritten: 0,
    skipped: [],
    failed: [],
    images: 0,
    topicsCreated: [],
  };

  const zip = await openZip(zipPath);
  try {
    const entries = await listEntries(zip);
    const files = entries.filter((e) => !e.fileName.endsWith("/"));

    for (const e of files) {
      // 路径穿越是攻击信号，不是脏数据：整包拒绝，不做「跳过这条继续」
      if (!isSafeEntryPath(e.fileName)) throw new ImportError(`压缩包内有非法路径：${e.fileName}`);
    }
    if (files.length > MAX_ENTRIES) throw new ImportError(`压缩包内文件超过 ${MAX_ENTRIES} 个，请分批导入`);
    const declared = files.reduce((sum, e) => sum + e.uncompressedSize, 0);
    if (declared > MAX_TOTAL_BYTES) throw new ImportError("压缩包解压后超过 500 MB，请分批导入");

    const mdEntries = files.filter((e) => isImportableMarkdownPath(e.fileName) && !e.fileName.startsWith(ASSET_PREFIX));
    const originalEntries = new Map<string, yauzl.Entry>();
    for (const e of files) {
      if (e.fileName.startsWith(ORIGINAL_PREFIX)) originalEntries.set(stemOf(e.fileName), e);
    }
    const displayEntries = new Map<string, yauzl.Entry>();
    for (const e of files) {
      if (e.fileName.startsWith(ASSET_PREFIX) && !e.fileName.startsWith(ORIGINAL_PREFIX)) {
        displayEntries.set(e.fileName.slice(ASSET_PREFIX.length), e);
      }
    }

    /* 先把全部 Markdown 解析出来、定下哪些会真正写入，再去导它们引用到的图。
       反过来做（先存图后写笔记）在重复导入时会一次次复制全部图片：那些图
       没有任何笔记引用，要等孤儿清扫过了 24 小时宽限期才回收，报告里的
       「图片 N 张」也在撒谎。这是真实往返验收抓到的，单元测试没覆盖。 */
    const topicCache = new Map<string, string>();
    const pending: { entry: yauzl.Entry; note: Omit<ImportedNote, "content">; body: string }[] = [];
    for (const entry of mdEntries) {
      try {
        const buf = await readEntry(zip, entry, MAX_MD_BYTES);
        const { data, body } = parseFrontMatter(buf.toString("utf8"));

        const rawId = toText(data.id);
        const id = ID_PATTERN.test(rawId)
          ? rawId
          : `import_${createHash("sha256").update(buf).digest("hex").slice(0, 32)}`;

        /* 这里的判重只为「要不要为它解压图片」，writeImportedNote 里那次才算数。
           判错的代价仅仅是多导一张图，不会写出不一致的数据。 */
        if (!opts.overwrite) {
          const existing = db.select({ deletedAt: notes.deletedAt }).from(notes).where(eq(notes.id, id)).get();
          if (existing) {
            report.skipped.push({ path: entry.fileName, reason: existing.deletedAt ? "已存在（在回收站里）" : "已存在" });
            continue;
          }
        }
        if (!body.trim()) {
          report.skipped.push({ path: entry.fileName, reason: "正文为空" });
          continue;
        }

        const segs = entry.fileName.split("/");
        const dirTopic = segs.length > 1 ? segs[segs.length - 2] : "";
        const createdAt = toTimestamp(data.created, Date.now());
        pending.push({
          entry,
          body,
          note: {
            id,
            topicId: resolveTopicId(
              db,
              toText(data.topic) || toText(data.category) || dirTopic,
              report.topicsCreated,
              topicCache,
            ),
            title: (toText(data.title) || firstLevelOneHeading(body) || stemOf(entry.fileName)).slice(0, 200),
            summary: toText(data.summary) || null,
            tags: toTags(data.tags),
            createdAt,
            // 缺 updated 时退回 created，而不是退回「现在」——
            // 否则一次导入会把所有旧笔记的更新时间抹平成导入当天
            updatedAt: toTimestamp(data.updated, createdAt),
          },
        });
      } catch (e) {
        report.failed.push({ path: entry.fileName, reason: e instanceof Error ? e.message : String(e) });
      }
    }

    // 只导真会被写入的笔记引用到的图；包里多余的图没有笔记可归属，落盘即孤儿
    const wanted = new Set<string>();
    for (const p of pending) for (const name of collectAssetRefs(p.body)) wanted.add(name);

    const urlByAsset = new Map<string, string>();
    for (const shortName of wanted) {
      const entry = displayEntries.get(shortName);
      if (!entry) continue;
      try {
        const buf = await readEntry(zip, entry, MAX_IMAGE_BYTES);
        const mime = sniffImageMime(buf);
        if (!mime || !IMAGE_EXT_BY_MIME[mime]) {
          report.failed.push({ path: entry.fileName, reason: "不是受支持的图片格式" });
          continue;
        }
        /* HEIC 原件与展示副本共用文件名主干，导出就是这么配对的。
           成对落库是 ADR-0014 的约束：只写副本，原件会成为永远回收不掉的孤儿。 */
        const originalEntry = originalEntries.get(stemOf(entry.fileName));
        let original: { buf: Buffer; mime: string; ext: string } | undefined;
        if (originalEntry) {
          const originalBuf = await readEntry(zip, originalEntry, MAX_IMAGE_BYTES);
          const originalMime = sniffImageMime(originalBuf);
          if (originalMime && HEIC_MIMES.has(originalMime)) {
            original = { buf: originalBuf, mime: originalMime, ext: "heic" };
          }
        }
        urlByAsset.set(shortName, saveImage(db, buf, mime, null, original).url);
        report.images += 1;
      } catch (e) {
        report.failed.push({ path: entry.fileName, reason: e instanceof Error ? e.message : String(e) });
      }
    }

    for (const { entry, note, body } of pending) {
      try {
        const result = writeImportedNote(db, { ...note, content: restoreImageRefs(body, urlByAsset) }, opts);
        if (result.outcome === "skipped") report.skipped.push({ path: entry.fileName, reason: result.reason ?? "已跳过" });
        else if (result.outcome === "overwritten") report.overwritten += 1;
        else report.imported += 1;
      } catch (e) {
        // 逐条独立：一篇写失败不该让整包回滚，前面导进去的都是好的
        report.failed.push({ path: entry.fileName, reason: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    zip.close();
  }

  return report;
}
