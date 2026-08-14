import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { ZipFile } from "yazl";
import { getDb } from "@/db";
import { buildExportPlan, exportZipName } from "@/lib/export";

export const dynamic = "force-dynamic";

// 导出全部数据：主题目录/标题-id.md + 顶层 assets/ 图片，yazl 流式写出不占内存。
// 计划构建（同步查询）失败时还能返回 JSON 错误；流开始后出错只能中断连接
export async function GET() {
  let plan;
  try {
    plan = buildExportPlan(getDb());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `导出失败: ${message}` }, { status: 500 });
  }

  const zip = new ZipFile();
  for (const entry of plan.mdEntries) {
    zip.addBuffer(Buffer.from(entry.content, "utf8"), entry.zipPath);
  }
  for (const asset of plan.assets) {
    // 图片本身已是压缩格式，store 模式省 CPU
    zip.addFile(asset.diskPath, asset.zipPath, { compress: false });
  }
  zip.end();

  zip.outputStream.on("error", (e) => console.error("[export] 打包中断:", e));

  return new Response(Readable.toWeb(zip.outputStream) as unknown as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${exportZipName()}"`,
      "Cache-Control": "no-store",
    },
  });
}
