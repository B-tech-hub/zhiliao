// 工具注册表。批次 C 的对话循环从这里取 toolDefs() 发给模型，用 runTool() 执行回调。

import type { ToolDef } from "@/lib/llm";
import { appendToNoteTool } from "./append-to-note";
import { createNoteTool } from "./create-note";
import { deleteNoteTool } from "./delete-note";
import { fetchUrlTool } from "./fetch-url";
import { generateImageTool } from "./generate-image";
import { listTopicsTool } from "./list-topics";
import { readNoteTool } from "./read-note";
import { searchNotesTool } from "./search-notes";
import { updateMetaTool } from "./update-meta";
import { ToolError, type AssistantTool, type ToolContext, type ToolOutcome } from "./types";

export type { AssistantTool, GeneratedImageRef, ToolContext, ToolOutcome, UndoPayload } from "./types";
export { ToolError, fingerprint, metaFingerprint } from "./types";
export { MAX_IMAGES_PER_MESSAGE } from "./generate-image";

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
  generateImageTool,
];

const BY_NAME = new Map(ASSISTANT_TOOLS.map((t) => [t.name, t]));

/* 来源问答不提供的工具：
   - fetch_url：抓来的网页内容不属于来源集，放行等于让「只依据来源回答」失效
   - generate_image：图必然出自模型自己的画风与世界知识，不可能只依据来源。
     想把来源内容画成图，用 Mermaid——纯文本、内容可逐字核对是否出自来源。
   写工具照常保留——写操作不影响回答的接地性，且「把结论存成笔记」是高频需求。 */
export const GROUNDED_BLOCKED_TOOLS = new Set(["fetch_url", "generate_image"]);

export function toolDefs(opts: { grounded?: boolean; imageGen?: boolean } = {}): ToolDef[] {
  let list = ASSISTANT_TOOLS;
  if (opts.grounded) list = list.filter((t) => !GROUNDED_BLOCKED_TOOLS.has(t.name));
  /* 没配图像模型就不把生图工具发出去。发了的后果是模型照调不误、
     收到一条「未配置」错误、再花一轮往返向用户道歉——用户看到的是
     一张失败卡片，而他根本没要求画图。 */
  if (!opts.imageGen) list = list.filter((t) => t.name !== "generate_image");
  return list.map((t) => t.def);
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
  /* 限域会话里模型仍可能凭记忆调用没发给它的工具（尤其是多轮之后），
     执行层必须自己拦一道，不能只靠 toolDefs 不发。 */
  if (ctx.allowedNoteIds !== undefined && GROUNDED_BLOCKED_TOOLS.has(name)) {
    return { content: `来源问答模式下不能使用 ${name}，只能依据来源集中的笔记回答。`, error: true };
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
