// AI 助手工具的统一契约。
// 给模型看的 JSON Schema 由 zod schema 生成，避免两份描述漂移。

import { createHash } from "node:crypto";
import { z } from "zod";
import type { DB } from "@/db";
import type { ToolDef } from "@/lib/llm";

export class ToolError extends Error {}

/* 状态指纹：撤销前比对，不一致说明笔记在助手写入之后又被改过。
   判据不能用 notes.updatedAt——后台 AI 处理完成时会自行刷新 updatedAt
   （process-note.ts 的 patch 里带着 updatedAt: Date.now()），
   而 create_note / append_to_note 都会重新入队 AI，几秒后笔记必然
   「看起来被改过」，撤销将永远不可用。指纹只覆盖该工具真正改动的字段。 */
export function fingerprint(...parts: (string | null | undefined)[]): string {
  const joined = parts.map((p) => p ?? "\u0000").join("\u0001");
  return createHash("sha256").update(joined).digest("hex").slice(0, 16);
}

// 元数据指纹。标签顺序不稳定（replaceNoteTags 会重建关联），排序后再算
export function metaFingerprint(topicId: string, title: string, tags: string[]): string {
  return fingerprint(topicId, title, [...tags].sort().join("|"));
}

/* 撤销所需的快照。批次 C 落进 messages.toolPayload，批次 D 渲染成操作卡片。
   afterUpdatedAt 保留作记录（操作卡片可显示发生时间），乐观锁判据是 afterFingerprint。 */
export interface UndoPayload {
  tool: string;
  noteId: string;
  // 反向操作所需的旧值，字段随工具而异
  before: Record<string, unknown>;
  afterUpdatedAt: number;
  // 助手写入后的状态指纹；缺省表示该操作的反向无损（如恢复回收站），无需比对
  afterFingerprint?: string;
}

export interface ToolOutcome {
  // 回灌给模型的文本结果
  content: string;
  // 引用溯源：本次结果涉及的 noteId。前端据此校验模型标注的引用是否真实存在
  noteIds?: string[];
  // 仅写工具有值
  undo?: UndoPayload;
  // 操作卡片上的一句话摘要
  summary?: string;
  // 执行失败（参数错、笔记不存在等）。结果照样回灌给模型，让它自行纠正
  error?: boolean;
}

export interface ToolContext {
  db: DB;
  // 本会话用户消息中出现过的 URL，fetch_url 的白名单
  userUrls: string[];
  /* 来源问答的限域白名单：只有这些笔记允许被检索与读取。
     undefined = 不限域（普通对话）；空数组 = 限域且当前一条来源都没有。
     两者语义不同，判空要用 !== undefined 而非 length。 */
  allowedNoteIds?: Set<string>;
  signal?: AbortSignal;
}

export interface AssistantTool {
  name: string;
  def: ToolDef;
  // 需用户确认后才执行；目前只有 delete_note
  requiresConfirm?: boolean;
  // 是否写数据（决定要不要产出操作卡片）
  mutates?: boolean;
  run(rawArgs: unknown, ctx: ToolContext): Promise<ToolOutcome>;
}

interface ToolSpec<T> {
  name: string;
  description: string;
  schema: z.ZodType<T>;
  requiresConfirm?: boolean;
  mutates?: boolean;
  run(args: T, ctx: ToolContext): Promise<ToolOutcome> | ToolOutcome;
}

// 参数校验在这里统一做，各工具的 run 只面对已校验的类型化参数
export function defineTool<T>(spec: ToolSpec<T>): AssistantTool {
  const parameters = z.toJSONSchema(spec.schema) as Record<string, unknown>;
  // $schema 对 OpenAI function calling 无意义，去掉以免个别供应商挑剔
  delete parameters.$schema;

  return {
    name: spec.name,
    requiresConfirm: spec.requiresConfirm,
    mutates: spec.mutates,
    def: {
      type: "function",
      function: { name: spec.name, description: spec.description, parameters },
    },
    async run(rawArgs, ctx) {
      const parsed = spec.schema.safeParse(rawArgs);
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((i) => `${i.path.join(".") || "参数"}: ${i.message}`)
          .join("；");
        throw new ToolError(`参数不合法（${detail}）`);
      }
      return await spec.run(parsed.data, ctx);
    },
  };
}
