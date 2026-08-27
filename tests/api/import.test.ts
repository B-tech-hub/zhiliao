/* 导入接口的这一层只做三件事：把请求体流式落到临时文件、挡住超大包、
   把 ImportError 翻成 400。逻辑本身由 tests/lib/import.test.ts 覆盖，
   这里只验证「不经过 formData 也能正确收到 zip」这条路。 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ZipFile } from "yazl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { notes } from "@/db/schema";
import { wipeData } from "../helpers/db";

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-import-api-"));
  dirs.push(dir);
  return dir;
}

function zipBytes(entries: { name: string; content: string }[]): Promise<Buffer> {
  const zip = new ZipFile();
  for (const e of entries) zip.addBuffer(Buffer.from(e.content, "utf8"), e.name);
  zip.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (c: Buffer) => chunks.push(c));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on("error", reject);
  });
}

async function post(body: Buffer | null, query = ""): Promise<{ status: number; data: Record<string, unknown> }> {
  const { POST } = await import("@/app/api/import/route");
  const req = new NextRequest(`http://localhost/api/import${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: body
      ? new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(body));
            controller.close();
          },
        })
      : undefined,
    // Node 的 fetch 要求流式请求体显式声明半双工
    ...({ duplex: "half" } as Record<string, unknown>),
  });
  const res = await POST(req);
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  wipeData();
  process.env.UPLOAD_DIR = tempDir();
  process.env.NOTES_EXPORT_DIR = tempDir();
});

afterEach(() => {
  wipeData();
  delete process.env.UPLOAD_DIR;
  delete process.env.NOTES_EXPORT_DIR;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/import", () => {
  it("原始 zip 字节作为请求体即可导入，返回报告", async () => {
    const body = await zipBytes([{ name: "读书/笔记-n1.md", content: '---\nid: "n1"\ntitle: "甲"\n---\n正文' }]);
    const { status, data } = await post(body);
    expect(status).toBe(200);
    expect(data.imported).toBe(1);
    expect(getDb().select().from(notes).all().length).toBe(1);
  });

  it("空请求体返回 400 而不是 500", async () => {
    const { status, data } = await post(null);
    expect(status).toBe(400);
    expect(data.error).toBe("请求里没有文件");
  });

  it("不是 zip 的内容返回 400 与可读的原因", async () => {
    const { status, data } = await post(Buffer.from("这不是压缩包"));
    expect(status).toBe(400);
    expect(String(data.error)).toContain("zip");
  });

  it("overwrite=1 时覆盖同 id 的笔记", async () => {
    const body = await zipBytes([{ name: "读书/笔记-n1.md", content: '---\nid: "n1"\ntitle: "甲"\n---\n包里的正文' }]);
    await post(body);
    getDb().update(notes).set({ content: "本地改过" }).run();

    const { data } = await post(body, "?overwrite=1");
    expect(data.overwritten).toBe(1);
    expect(getDb().select().from(notes).all()[0].content).toBe("包里的正文");
  });

  it("导入产生的临时文件不会残留", async () => {
    const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("zhiliao-import-")).length;
    await post(await zipBytes([{ name: "读书/笔记-n1.md", content: '---\nid: "n1"\n---\n正文' }]));
    const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("zhiliao-import-")).length;
    expect(after).toBe(before);
  });
});
