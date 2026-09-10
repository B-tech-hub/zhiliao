import type { Note } from "@/db/schema";

// Server Component 传给 Client Component 时，移除 SQLite BLOB 向量字段。
// 向量只供服务端检索使用，客户端列表与编辑器不需要它。
export type ClientNote = Omit<Note, "embedding">;

export function toClientNote(note: Note): ClientNote {
  const { embedding, ...serializable } = note;
  void embedding;
  return serializable;
}
