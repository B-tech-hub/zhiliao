import { and, eq, isNull } from "drizzle-orm";
import { Jieba } from "@node-rs/jieba";
import { dict } from "@node-rs/jieba/dict";
import { getSqlite, type DB } from "@/db";
import { notes } from "@/db/schema";
import { getTagsForNotes } from "@/lib/notes";

// jieba 实例加载词典较重，进程内只初始化一次
const g = globalThis as unknown as { __kbJieba?: Jieba };

function getJieba(): Jieba {
  if (!g.__kbJieba) {
    g.__kbJieba = Jieba.withDict(dict);
  }
  return g.__kbJieba;
}

// 搜索引擎模式分词（多粒度切分，提升召回），空格连接后写入 FTS 影子列
export function segment(text: string): string {
  if (!text.trim()) return "";
  return getJieba().cutForSearch(text, true).join(" ");
}

// 重写某条笔记的 FTS 行；笔记不存在或在回收站则仅删除对应行
export function refreshNoteFts(db: DB, noteId: string): void {
  const sqlite = getSqlite();
  const note = db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
    .get();
  sqlite.prepare("DELETE FROM notes_fts WHERE note_id = ?").run(noteId);
  if (!note) return;
  const tagNames = getTagsForNotes(db, [noteId]).get(noteId) ?? [];
  sqlite
    .prepare("INSERT INTO notes_fts (note_id, title_seg, content_seg, tags_seg) VALUES (?, ?, ?, ?)")
    .run(noteId, segment(note.title), segment(note.content), segment(tagNames.join(" ")));
}

export function removeNoteFts(noteId: string): void {
  getSqlite().prepare("DELETE FROM notes_fts WHERE note_id = ?").run(noteId);
}

// 全量重建（迁移后补建 / 修复失步）：FTS 行数与未删除笔记数不一致时执行。
// 基准必须排除回收站笔记（它们不在 FTS 里），否则恒等式永久破缺、每次启动都重建
export function rebuildFtsIfNeeded(db: DB): void {
  const sqlite = getSqlite();
  const ftsCount = (sqlite.prepare("SELECT COUNT(*) AS c FROM notes_fts").get() as { c: number }).c;
  const noteCount = (
    sqlite.prepare("SELECT COUNT(*) AS c FROM notes WHERE deleted_at IS NULL").get() as { c: number }
  ).c;
  if (ftsCount === noteCount) return;
  console.log(`[fts] 重建索引：notes=${noteCount} fts=${ftsCount}`);
  sqlite.prepare("DELETE FROM notes_fts").run();
  const ids = (
    sqlite.prepare("SELECT id FROM notes WHERE deleted_at IS NULL").all() as { id: string }[]
  ).map((r) => r.id);
  for (const id of ids) {
    refreshNoteFts(db, id);
  }
}

// 关键词搜索：分词后 MATCH，bm25 加权（标题 > 标签 > 正文）；
// 1 字查询或 MATCH 无结果时降级 LIKE。返回有序 noteId 与查询词（供前端高亮）。
// allowedIds 限定候选范围（来源问答）：先多取再过滤，避免前 limit 条恰好都在范围外时颗粒无收。
export function searchNoteIds(
  query: string,
  limit = 50,
  allowedIds?: Set<string>,
): { ids: string[]; terms: string[] } {
  const sqlite = getSqlite();
  const q = query.trim();
  if (!q) return { ids: [], terms: [] };
  if (allowedIds?.size === 0) return { ids: [], terms: [q] };

  const terms = getJieba()
    .cutForSearch(q, true)
    .map((t) => t.trim())
    .filter((t) => t && !/^[\s\p{P}]+$/u.test(t));

  const fetchLimit = allowedIds ? Math.max(limit * 10, 200) : limit;
  let ids: string[] = [];
  if (q.length > 1 && terms.length > 0) {
    // 每个词加引号防 FTS 语法注入，AND 连接要求全部命中
    const match = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" AND ");
    try {
      ids = (
        sqlite
          .prepare(
            `SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?
             ORDER BY bm25(notes_fts, 0, 5.0, 1.0, 3.0) LIMIT ?`,
          )
          .all(match, fetchLimit) as { note_id: string }[]
      ).map((r) => r.note_id);
    } catch {
      ids = [];
    }
    if (allowedIds) ids = ids.filter((id) => allowedIds.has(id));
  }

  if (ids.length === 0) {
    // 降级：LIKE 扫标题与正文（个人量级可接受）；OR 必须括号包裹再排除回收站
    const like = `%${q}%`;
    ids = (
      sqlite
        .prepare(
          `SELECT id FROM notes WHERE (title LIKE ? OR content LIKE ?) AND deleted_at IS NULL
           ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(like, like, fetchLimit) as { id: string }[]
    ).map((r) => r.id);
    if (allowedIds) ids = ids.filter((id) => allowedIds.has(id));
  }
  if (allowedIds) ids = ids.slice(0, limit);

  // 高亮词按长度降序，避免长词被短词拆散
  const highlightTerms = [...new Set([q, ...terms])].sort((a, b) => b.length - a.length);
  return { ids, terms: highlightTerms };
}

// 根据查询词生成摘录：截取首个命中词前后文
export function makeExcerpt(content: string, terms: string[]): string {
  const plain = content.replace(/[#*`>\[\]!]/g, "").replace(/\s+/g, " ");
  let idx = -1;
  for (const t of terms) {
    idx = plain.indexOf(t);
    if (idx >= 0) break;
  }
  if (idx < 0) return plain.slice(0, 80);
  const start = Math.max(0, idx - 40);
  const end = Math.min(plain.length, idx + 60);
  return (start > 0 ? "…" : "") + plain.slice(start, end) + (end < plain.length ? "…" : "");
}
