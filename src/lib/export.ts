import fs from "node:fs";
import path from "node:path";
import { asc, eq, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { images, notes, topics, type Note } from "@/db/schema";
import { extractImageFilenames } from "@/lib/image-refs";
import { getTagsForNotes } from "@/lib/notes";

// Windows 保留设备名（含带扩展名形态，如 con.txt 解压时同样非法）
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// zip 条目名的 Windows 安全化：非法字符与控制字符换下划线、去结尾点/空格、
// 保留设备名加前缀、超长截断；结果为空时用 fallback
export function sanitizeEntryName(raw: string, fallback: string): string {
  let s = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  s = s.replace(/[. ]+$/, "");
  if (s.length > 60) s = s.slice(0, 60).replace(/[. ]+$/, "");
  if (WINDOWS_RESERVED.test(s)) s = `_${s}`;
  return s || fallback;
}

// 本地图片引用改写为 zip 内相对路径。md 位于 主题目录/ 下一层，assets 在顶层，
// 故相对前缀固定为 ../assets/；Markdown 与内嵌 <img> 两种形态的 URL 前缀相同，一次替换全覆盖
export function rewriteImageRefs(content: string): string {
  return content.replaceAll("/api/images/", "../assets/");
}

// frontmatter + 改写后正文。字符串值一律 JSON.stringify——JSON 是 YAML 1.2
// 的合法标量子集，标题含引号/冒号/井号时无转义坑；带 id 为将来反向导入的去重铺路
export function renderNoteMarkdown(
  note: Pick<Note, "id" | "title" | "content" | "summary" | "createdAt" | "updatedAt">,
  topicName: string,
  tagNames: string[],
): string {
  const lines = [
    "---",
    `id: ${JSON.stringify(note.id)}`,
    `title: ${JSON.stringify(note.title)}`,
    `topic: ${JSON.stringify(topicName)}`,
    `tags: [${tagNames.map((t) => JSON.stringify(t)).join(", ")}]`,
    `created: ${new Date(note.createdAt).toISOString()}`,
    `updated: ${new Date(note.updatedAt).toISOString()}`,
  ];
  if (note.summary) lines.push(`summary: ${JSON.stringify(note.summary)}`);
  lines.push("---", "", rewriteImageRefs(note.content), "");
  return lines.join("\n");
}

export interface ExportPlan {
  mdEntries: { zipPath: string; content: string }[];
  assets: { zipPath: string; diskPath: string }[];
}

// 组装导出计划：主题目录/标题-id.md + 顶层 assets/ 被引用图片清单。
// 只含未删除笔记；主题名 sanitize 后碰撞（如 a/b 与 a:b）时后到者加序号；
// zipPath 一律 / 分隔（zip 规范），diskPath 交给平台 path
export function buildExportPlan(db: DB): ExportPlan {
  const rows = db
    .select({ note: notes, topicName: topics.name })
    .from(notes)
    .innerJoin(topics, eq(notes.topicId, topics.id))
    .where(isNull(notes.deletedAt))
    .orderBy(asc(notes.createdAt))
    .all();

  const tagMap = getTagsForNotes(
    db,
    rows.map((r) => r.note.id),
  );

  const dirByTopic = new Map<string, string>();
  const usedDirs = new Set<string>();
  for (const { topicName } of rows) {
    if (dirByTopic.has(topicName)) continue;
    const base = sanitizeEntryName(topicName, "未命名主题");
    let dir = base;
    for (let i = 2; usedDirs.has(dir); i++) dir = `${base}-${i}`;
    usedDirs.add(dir);
    dirByTopic.set(topicName, dir);
  }

  const wanted = new Set<string>();
  const mdEntries = rows.map(({ note, topicName }) => {
    for (const f of extractImageFilenames(note.content)) wanted.add(path.basename(f));
    const file = `${sanitizeEntryName(note.title, "无标题")}-${note.id}.md`;
    // 标签排序保证两次导出内容可 diff（底层查询本就不保证顺序）
    const tagNames = [...(tagMap.get(note.id) ?? [])].sort();
    return {
      zipPath: `${dirByTopic.get(topicName)}/${file}`,
      content: renderNoteMarkdown(note, topicName, tagNames),
    };
  });

  const uploadDir = process.env.UPLOAD_DIR || "./data/uploads";
  const assets = [...wanted].sort().flatMap((f) => {
    const img = db.select().from(images).where(eq(images.filename, f)).get();
    const out = [{ zipPath: `assets/${f}`, diskPath: path.join(uploadDir, f) }];
    if (img?.originalFilename) out.push({ zipPath: `assets/originals/${img.originalFilename}`, diskPath: path.join(uploadDir, img.originalFilename) });
    return out;
  }).filter((a) => fs.existsSync(a.diskPath));

  return { mdEntries, assets };
}

export function exportZipName(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `zhiliao-export-${stamp}.zip`;
}
