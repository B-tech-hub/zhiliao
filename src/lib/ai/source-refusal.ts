// 来源问答的固定拒答句。提示词要求模型原样说出，但模型常把主题嵌进去。
// 最终回答在这里收口。只有白名单里的笔记引用才算已经引用来源，这种回答不改。
// 伪造脚注不算引用，不能挡住固定句。

export const SOURCE_REFUSAL_SENTENCE = "来源笔记中没有相关内容";

const INSERTED_TOPIC = /来源笔记中没有[\s\S]{0,120}?相关内容/;
// 单独的「没有相关内容」太宽，正常说明也会撞上，不能当成拒答。
const REFUSAL_HINT = /来源(笔记|集)?(里|中)没有|未找到相关|没有找到相关|不在来源/;
const CITATION_RE = /\[\^(?:noteId:)?([A-Za-z0-9_-]+)\]/g;

function citesAllowedNote(text: string, allowed?: ReadonlySet<string>): boolean {
  if (!allowed || allowed.size === 0) return false;
  for (const match of text.matchAll(CITATION_RE)) {
    if (match[1] && allowed.has(match[1])) return true;
  }
  return false;
}

export function enforceSourceRefusal(text: string, allowedNoteIds?: ReadonlySet<string>): string {
  if (!text || text.includes(SOURCE_REFUSAL_SENTENCE)) return text;
  if (citesAllowedNote(text, allowedNoteIds)) return text;
  if (INSERTED_TOPIC.test(text)) return text.replace(INSERTED_TOPIC, SOURCE_REFUSAL_SENTENCE);
  if (REFUSAL_HINT.test(text)) {
    return `${SOURCE_REFUSAL_SENTENCE}。${text.trimStart()}`;
  }
  return text;
}
