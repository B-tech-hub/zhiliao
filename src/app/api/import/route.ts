import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { newId } from "@/lib/ids";
import { ImportError, importZipFile } from "@/lib/import";

export const dynamic = "force-dynamic";

// 与 import.ts 里解压后的总量上限呼应；压缩态先在这里挡一道
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/* 导入 Markdown zip。请求体直接是 zip 原始字节而不是 multipart：
   包可能有几百 MB，走 formData 会整个读进内存，这里边收边落临时文件。
   选项走查询串，省掉一个 multipart 解析器。 */
export async function POST(req: NextRequest) {
  if (!req.body) return NextResponse.json({ error: "请求里没有文件" }, { status: 400 });

  const overwrite = req.nextUrl.searchParams.get("overwrite") === "1";
  const runAi = req.nextUrl.searchParams.get("runAi") === "1";

  const tempPath = path.join(os.tmpdir(), `zhiliao-import-${newId()}.zip`);
  try {
    let received = 0;
    const counted = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > MAX_UPLOAD_BYTES) throw new Error("too_large");
        controller.enqueue(chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(req.body.pipeThrough(counted) as never),
        fs.createWriteStream(tempPath),
      );
    } catch (e) {
      if (e instanceof Error && e.message.includes("too_large")) {
        return NextResponse.json({ error: "压缩包不能超过 200 MB，请分批导入" }, { status: 400 });
      }
      throw e;
    }
    if (received === 0) return NextResponse.json({ error: "请求里没有文件" }, { status: 400 });

    const report = await importZipFile(getDb(), tempPath, { overwrite, runAi });
    return NextResponse.json(report);
  } catch (e) {
    // ImportError 是「这个包有问题」，说得清就直接告诉用户；其余当 500
    if (e instanceof ImportError) return NextResponse.json({ error: e.message }, { status: 400 });
    const message = e instanceof Error ? e.message : String(e);
    console.error("[import] 导入失败:", message);
    return NextResponse.json({ error: `导入失败：${message}` }, { status: 500 });
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* 临时文件没建起来或已被清掉 */
    }
  }
}
