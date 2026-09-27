import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { images } from "@/db/schema";
import { GET } from "@/app/api/images/[filename]/route";
import { POST } from "@/app/api/uploads/route";
import { wipeData } from "../helpers/db";

const fixtureDir = path.resolve("tests/fixtures/images");
const historicalId = "e03aab43-df51-41a6-a409-ba143c5984e7";
let uploadDir: string;

function readImage(filename: string) {
  return GET(new NextRequest(`http://localhost/api/images/${encodeURIComponent(filename)}`), {
    params: Promise.resolve({ filename }),
  });
}

function insertImage(filename: string, bytes: Buffer, mime: string, writeFile = true) {
  getDb().insert(images).values({
    id: filename.slice(0, filename.lastIndexOf(".")),
    filename,
    mime,
    size: bytes.length,
    createdAt: Date.now(),
  }).run();
  if (writeFile) fs.writeFileSync(path.join(uploadDir, filename), bytes);
}

beforeEach(() => {
  wipeData();
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-images-api-"));
  vi.stubEnv("UPLOAD_DIR", uploadDir);
  vi.stubEnv("DEMO_MODE", "false");
});

afterEach(() => {
  wipeData();
  vi.unstubAllEnvs();
  // 只删除本用例创建的临时目录，不触碰正式上传路径。
  if (path.dirname(uploadDir) !== path.resolve(os.tmpdir()) || !path.basename(uploadDir).startsWith("zhiliao-images-api-")) {
    throw new Error("测试临时目录越界");
  }
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

describe("GET /api/images/[filename]", () => {
  it("已有 UUID JPEG 无需改名即可读取，返回原字节和响应头", async () => {
    const sharp = (await import("sharp")).default;
    const bytes = await sharp(fs.readFileSync(path.join(fixtureDir, "pattern.png"))).jpeg().toBuffer();
    const filename = `${historicalId}.jpg`;
    insertImage(filename, bytes, "image/jpeg");

    const response = await readImage(filename);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Content-Length")).toBe(String(bytes.length));
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it("旧字母数字 id 图片继续返回原字节", async () => {
    const bytes = fs.readFileSync(path.join(fixtureDir, "pattern.png"));
    insertImage("abc123.png", bytes, "image/png");
    const response = await readImage("abc123.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it.each([
    "../abc.jpg", "..\\abc.jpg", "/abc.jpg", "C:\\abc.jpg", "sub/abc.jpg", "sub\\abc.jpg",
    "%2e%2e%2fabc.jpg", "%252e%252e%252fabc.jpg", "abc%2fdef.jpg", "abc.jpg\0", "abc.jpg\n",
    "abc.jpg/extra", "abc.jpg.exe", "abc.svg", "abc.heic", "abc.jpeg", "abc.JPG", "",
    "abc-def.jpg", `${historicalId.slice(0, -1)}.jpg`, `${historicalId.replace("e", "g")}.jpg`,
    `${historicalId}.heic`, `${historicalId}.jpg\n`,
  ])("非法名称 %j 返回 400", async (filename) => {
    const response = await readImage(filename);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "非法文件名" });
  });

  it.each(["absent.png", `${historicalId}.jpg`, "absent.gif", "absent.webp"])("合法名称 %s 查无记录返回 404", async (filename) => {
    fs.writeFileSync(path.join(uploadDir, filename), "not registered");
    const response = await readImage(filename);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "图片不存在" });
  });

  it.each(["absent.jpg", `${historicalId}.jpg`])("已入库名称 %s 缺少磁盘文件返回 404", async (filename) => {
    insertImage(filename, Buffer.from("missing"), "image/jpeg", false);
    const response = await readImage(filename);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "图片文件丢失" });
  });

  it("真实 HEIC 上传返回的 JPEG URL 可读取且原件保持", async () => {
    const original = fs.readFileSync(path.join(fixtureDir, "pattern.heic"));
    const form = new FormData();
    form.set("file", new File([original], "pattern.heic", { type: "image/heic" }));
    const uploaded = await POST(new NextRequest("http://localhost/api/uploads", { method: "POST", body: form }));
    expect(uploaded.status).toBe(201);
    const { url } = await uploaded.json();
    const records = getDb().select().from(images).all();
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(url).toBe(`/api/images/${record.filename}`);
    expect(record.originalFilename).toBe(`${record.id}.heic`);
    expect(fs.readFileSync(path.join(uploadDir, record.originalFilename!))).toEqual(original);

    const response = await readImage(url.slice("/api/images/".length));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes).toEqual(fs.readFileSync(path.join(uploadDir, record.filename)));
    expect(bytes.length).toBe(record.size);
    expect(response.headers.get("Content-Length")).toBe(String(bytes.length));
    const sharp = (await import("sharp")).default;
    expect(await sharp(bytes).metadata()).toMatchObject({ format: "jpeg", width: 96, height: 64 });
    expect((await readImage(record.originalFilename!)).status).toBe(400);
  });
});
