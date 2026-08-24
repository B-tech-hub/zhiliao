import { and, eq, isNull } from "drizzle-orm";
import { Jieba } from "@node-rs/jieba";
import { dict } from "@node-rs/jieba/dict";
import { getSqlite, type DB } from "@/db";
import { notes } from "@/db/schema";
import { getTagsForNotes } from "@/lib/notes";
import { embedText } from "@/lib/ai/embedding";
import { isEmbeddingConfigured, getEmbeddingConfig } from "@/lib/llm-config";

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
): { ids: string[]; terms: string[]; scores?: Record<string, number> } {
  const sqlite = getSqlite();
  const q = query.trim();
  if (!q) return { ids: [], terms: [] };
  if (allowedIds?.size === 0) return { ids: [], terms: [q], scores: {} };

  const terms = getJieba()
    .cutForSearch(q, true)
    .map((t) => t.trim())
    .filter((t) => t && !/^[\s\p{P}]+$/u.test(t));

  const fetchLimit = allowedIds ? Math.max(limit * 10, 200) : limit;
  let ids: string[] = [];
  const scores: Record<string, number> = {};
  if (q.length > 1 && terms.length > 0) {
    // OR 先扩大召回；命中多个词的结果按命中数加权，避免自然语言查询因一个词未出现而归零。
    const match = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
    try {
      const rows = (
        sqlite
          .prepare(
            `SELECT note_id, bm25(notes_fts, 0, 5.0, 1.0, 3.0) AS rank
             FROM notes_fts WHERE notes_fts MATCH ? LIMIT ?`,
          )
          .all(match, fetchLimit) as { note_id: string; rank: number }[]
      );
      const termHit = new Map<string, number>();
      for (const term of terms) {
        const one = `"${term.replace(/"/g, '""')}"`;
        try {
          const hitRows = sqlite.prepare("SELECT note_id FROM notes_fts WHERE notes_fts MATCH ? LIMIT ?").all(one, fetchLimit) as { note_id: string }[];
          for (const row of hitRows) termHit.set(row.note_id, (termHit.get(row.note_id) ?? 0) + 1);
        } catch { /* 单词异常时沿用 OR 结果 */ }
      }
      rows.sort((a, b) => {
        const ah = termHit.get(a.note_id) ?? 1;
        const bh = termHit.get(b.note_id) ?? 1;
        return (bh - ah) || (a.rank - b.rank);
      });
      ids = rows.map((r) => r.note_id);
      for (const row of rows) scores[row.note_id] = (termHit.get(row.note_id) ?? 1) / (1 + Math.max(0, row.rank));
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
    ids.forEach((id, index) => { scores[id] = 1 / (index + 1); });
  }
  if (allowedIds) ids = ids.slice(0, limit);

  // 高亮词按长度降序，避免长词被短词拆散
  const highlightTerms = [...new Set([q, ...terms])].sort((a, b) => b.length - a.length);
  return { ids, terms: highlightTerms, scores };
}

export interface HybridSearchResult {
  ids: string[];
  terms: string[];
  scores: Record<string, number>;
  staleEmbeddingCount: number;
  vectorEnabled: boolean;
}

function cosineSimilarity(a: Buffer, b: number[], dim: number): number | null {
  if (a.length !== dim * 4) return null;
  // better-sqlite3 的 BLOB 走 node::Buffer::Copy，独占 ArrayBuffer 且 byteOffset 恒为 0，
  // 因此可以零拷贝转视图；若换驱动导致偏移非 4 的倍数，这里会抛 RangeError 而非静默算错。
  const av = new Float32Array(a.buffer, a.byteOffset, dim);
  let dot = 0; let an = 0; let bn = 0;
  for (let i = 0; i < dim; i++) { dot += av[i] * b[i]; an += av[i] * av[i]; bn += b[i] * b[i]; }
  if (!an || !bn) return null;
  return dot / (Math.sqrt(an) * Math.sqrt(bn));
}

export function vectorSearch(query: number[], limit = 50, allowedIds?: Set<string>): { ids: string[]; scores: Record<string, number>; staleEmbeddingCount: number } {
  const cfg = getEmbeddingConfig();
  const sqlite = getSqlite();
  const rows = sqlite.prepare("SELECT id, embedding, embedding_model, embedding_dim FROM notes WHERE deleted_at IS NULL AND embedding IS NOT NULL").all() as { id: string; embedding: Buffer; embedding_model: string | null; embedding_dim: number | null }[];
  let staleEmbeddingCount = 0;
  const scored: { id: string; score: number }[] = [];
  for (const row of rows) {
    // 先按检索范围过滤，提示条数才与用户当前看到的范围一致
    if (allowedIds && !allowedIds.has(row.id)) continue;
    /* 模型名与维度必须同时对上才能进同一次相似度计算。只看模型名是不够的：
       同名模型换了默认输出维度（或供应商支持 dimensions 参数）时，这批向量会被
       悄悄排除，用户既搜不到又看不到任何提示——把它们一并计入 stale 才有得救。 */
    if (row.embedding_model !== cfg.model || row.embedding_dim !== query.length) {
      staleEmbeddingCount++;
      continue;
    }
    const score = cosineSimilarity(row.embedding, query, query.length);
    // 零向量或字节数对不上：算不出相似度就不能拿哨兵分冒充结果去占名额
    if (score === null) {
      staleEmbeddingCount++;
      continue;
    }
    scored.push({ id: row.id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  return { ids: top.map((r) => r.id), scores: Object.fromEntries(top.map((r) => [r.id, r.score])), staleEmbeddingCount };
}

export async function hybridSearchNoteIds(query: string, limit = 50, allowedIds?: Set<string>): Promise<HybridSearchResult> {
  const bm25 = searchNoteIds(query, Math.max(limit * 3, 50), allowedIds);
  if (!isEmbeddingConfigured()) {
    return { ids: bm25.ids.slice(0, limit), terms: bm25.terms, scores: bm25.scores ?? {}, staleEmbeddingCount: 0, vectorEnabled: false };
  }
  let vector: { ids: string[]; scores: Record<string, number>; staleEmbeddingCount: number };
  try { vector = vectorSearch(await embedText(query), Math.max(limit * 3, 50), allowedIds); }
  catch (e) {
    /* 供应商不可用（401/429/超时）时降级为 BM25，搜索本身不能因此失败。
       但必须留痕：静默降级会让用户以为语义检索一直在工作，而结果只是「差一点」。 */
    console.warn("[search] Embedding 请求失败，本次降级为纯 BM25:", e instanceof Error ? e.message : e);
    return { ids: bm25.ids.slice(0, limit), terms: bm25.terms, scores: bm25.scores ?? {}, staleEmbeddingCount: 0, vectorEnabled: false };
  }
  const ranks = new Map<string, number>();
  bm25.ids.forEach((id, i) => ranks.set(id, (ranks.get(id) ?? 0) + 1 / (60 + i + 1)));
  vector.ids.forEach((id, i) => ranks.set(id, (ranks.get(id) ?? 0) + 1 / (60 + i + 1)));
  const ids = [...ranks.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
  return { ids, terms: bm25.terms, scores: Object.fromEntries(ranks), staleEmbeddingCount: vector.staleEmbeddingCount, vectorEnabled: true };
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
