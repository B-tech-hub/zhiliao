import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GET as knowledgeGet } from "@/app/api/external/knowledge/route";

const requestSchema = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number(), z.null()]), method: z.string(), params: z.record(z.string(), z.unknown()).optional() });

export async function POST(req: NextRequest) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } }, { status: 400 });
  const { id, method, params = {} } = parsed.data;
  if (method === "initialize") return NextResponse.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-03-26", serverInfo: { name: "zhiliao", version: "0.5.0" }, capabilities: { tools: {} } } });
  if (method === "tools/list") return NextResponse.json({ jsonrpc: "2.0", id, result: { tools: [{ name: "search_knowledge", description: "搜索知识库中的笔记", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } }, { name: "get_knowledge", description: "读取知识库笔记", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }] } });
  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, string>;
    if (!["search_knowledge", "get_knowledge"].includes(name)) return NextResponse.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    const url = new URL("/api/external/knowledge", req.url);
    if (args.query) url.searchParams.set("q", args.query);
    if (args.limit) url.searchParams.set("limit", args.limit);
    const response = await knowledgeGet(new NextRequest(url, { headers: req.headers }));
    const data = await response.json();
    if (!response.ok) return NextResponse.json({ jsonrpc: "2.0", id, error: { code: -32001, message: data.error || "Unauthorized" } }, { status: response.status });
    return NextResponse.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(data) }] } });
  }
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
}
