// 工具注册表。批次 C 的对话循环从这里取 toolDefs() 发给模型，用 runTool() 执行回调。

import type { ToolDef } from "@/lib/llm";
import { appendToNoteTool } from "./append-to-note";
import { createNoteTool } from "./create-note";
import { deleteNoteTool } from "./delete-note";
import { fetchUrlTool } from "./fetch-url";
import { listTopicsTool } from "./list-topics";
import { readNoteTool } from "./read-note";
import { searchNotesTool } from "./search-notes";
import { updateMetaTool } from "./update-meta";
import { ToolError, type AssistantTool, type ToolContext, type ToolOutcome } from "./types";

export type { AssistantTool, ToolContext, ToolOutcome, UndoPayload } from "./types";
export { ToolError } from "./types";

// 单个工具结果回灌上限：多轮工具调用累积起来会撑爆上下文
export const MAX_TOOL_RESULT_CHARS = 8000;

export const ASSISTANT_TOOLS: AssistantTool[] = [
  searchNotesTool,
  readNoteTool,
  listTopicsTool,
  createNoteTool,
  appendToNoteTool,
  updateMetaTool,
  deleteNoteTool,
  fetchUrlTool,
];

const BY_NAME = new Map(ASSISTANT_TOOLS.map((t) => [t.name, t]));

export function toolDefs(): ToolDef[] {
  return ASSISTANT_TOOLS.map((t) => t.def);
}

export function getTool(name: string): AssistantTool | undefined {
  return BY_NAME.get(name);
}

/* 执行一次工具调用。参数是模型给的原始 JSON 字符串。
   一切失败都转成「带 error 标记的正常结果」而非抛出——
   工具失败（笔记不存在、参数写错、网址被拒）是模型可以自行纠正的情况，
   打断整条对话反而让用户什么也拿不到。 */
export async function runTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const tool = BY_NAME.get(name);
  if (!tool) {
    return { content: `不存在名为 ${name} 的工具，可用工具：${[...BY_NAME.keys()].join("、")}`, error: true };
  }

  let args: unknown = {};
  if (rawArgs.trim()) {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      return { content: `工具 ${name} 的参数不是合法 JSON，请重新生成`, error: true };
    }
  }

  try {
    const outcome = await tool.run(args, ctx);
    if (outcome.content.length > MAX_TOOL_RESULT_CHARS) {
      return {
        ...outcome,
        content: `${outcome.content.slice(0, MAX_TOOL_RESULT_CHARS)}\n…（结果过长已截断）`,
      };
    }
    return outcome;
  } catch (e) {
    if (e instanceof ToolError) {
      return { content: `工具 ${name} 执行失败：${e.message}`, error: true };
    }
    // 非预期错误（DB 异常等）记日志后同样回灌，避免整条对话中断
    console.error(`[tools] ${name} 执行异常`, e);
    return {
      content: `工具 ${name} 执行异常：${e instanceof Error ? e.message : String(e)}`,
      error: true,
    };
  }
}
