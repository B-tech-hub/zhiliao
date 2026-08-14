// AI 助手工具的统一契约。
// 给模型看的 JSON Schema 由 zod schema 生成，避免两份描述漂移。

import { z } from "zod";
import type { DB } from "@/db";
import type { ToolDef } from "@/lib/llm";

export class ToolError extends Error {}

/* 撤销所需的快照。批次 C 落进 messages.toolPayload，批次 D 渲染成操作卡片。
   afterUpdatedAt 是乐观锁基准：撤销时若 notes.updatedAt 已经变了，
   说明笔记在此之后被改过，反向操作会覆盖用户的新编辑，必须禁止。 */
export interface UndoPayload {
  tool: string;
  noteId: string;
  // 反向操作所需的旧值，字段随工具而异
  before: Record<string, unknown>;
  afterUpdatedAt: number;
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
