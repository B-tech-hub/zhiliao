import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ZipFile } from "yazl";

import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { demoForbiddenResponse, isDemoMode } from "@/lib/demo-guard";
import { middleware } from "@/middleware";
import { wipeData } from "../helpers/db";

function watchRequestBody(request: NextRequest) {
  const readers = ["json", "text", "arrayBuffer", "blob", "formData", "clone"] as const;
  const calls = [
    ...readers.map((method) => vi.spyOn(request, method)),
    ...(request.body ? [
      vi.spyOn(request.body, "getReader"),
      vi.spyOn(request.body, "pipeThrough"),
      vi.spyOn(request.body, "pipeTo"),
      vi.spyOn(request.body, "tee"),
    ] : []),
  ];
  return () => {
    for (const call of calls) expect(call).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
  };
}

async function createImportBody(): Promise<Buffer> {
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from("# Demo\n\n导入边界测试笔记\n"), "demo.md");
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on("error", reject);
  });
  zip.end();
  return complete;
}

function createUploadBody(): FormData {
  const form = new FormData();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
  form.set("file", new Blob([png], { type: "image/png" }), "demo.png");
  return form;
}

describe.each([
  { label: "源码", runtime: "local", baseUrl: "http://127.0.0.1:8787/v1" },
  { label: "容器", runtime: undefined, baseUrl: "http://mockllm:8787/v1" },
])("Demo 服务端能力边界（$label）", ({ runtime, baseUrl }) => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-demo-boundary-"));
  });

  afterEach(async () => {
    // 笔记保存会延后导出，先等本轮写入结束，再恢复环境和清理临时目录。
    await new Promise<void>((resolve) => setImmediate(resolve));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterAll(() => {
    if (!fixtureDir) return;
    const resolved = fs.realpathSync(fixtureDir);
    if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith("zhiliao-demo-boundary-")) {
      throw new Error("测试目录超出临时目录边界，停止清理");
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  beforeEach(() => {
    wipeData();
    vi.stubEnv("DEMO_MODE", "");
    vi.stubEnv("DEMO_RUNTIME", runtime);
    vi.stubEnv("DEMO_LLM_BASE_URL", undefined);
    vi.stubEnv("NOTES_EXPORT_DIR", path.join(fixtureDir, "notes"));
    vi.stubEnv("UPLOAD_DIR", path.join(fixtureDir, "uploads"));
  });

  it("仅在 DEMO_MODE=1 时启用", () => {
    expect(isDemoMode()).toBe(false);
    process.env.DEMO_MODE = "1";
    expect(isDemoMode()).toBe(true);
  });

  it("Demo 使用当前运行方式的固定 mock，不读取可改写端点", async () => {
    process.env.DEMO_MODE = "1";
    vi.stubEnv("DEMO_LLM_BASE_URL", "https://attacker.invalid/v1");
    const { getLlmConfig } = await import("@/lib/llm-config");
    expect(getLlmConfig().baseUrl).toBe(baseUrl);
  });

  it("统一返回 403 且不依赖请求内容", async () => {
    const response = demoForbiddenResponse();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "体验模式不支持此操作" });
  });

  it.each([
    ["缺少长度", undefined, 411],
    ["非数字长度", "invalid", 400],
    ["负数长度", "-1", 400],
    ["合并的多个长度", "1, 1", 400],
    ["超过 200 MB", String(200 * 1024 * 1024 + 1), 413],
    ["超过整数精度", "9007199254740992", 413],
  ] as const)("拒绝 Demo 请求体：%s", async (_label, contentLength, status) => {
    process.env.DEMO_MODE = "1";
    const request = new NextRequest("http://x/api/notes", {
      method: "POST",
      body: "x",
      headers: contentLength === undefined ? { "Transfer-Encoding": "chunked" } : { "Content-Length": contentLength },
    });

    expect((await middleware(request)).status).toBe(status);
    expect(request.bodyUsed).toBe(false);
  });

  it("拒绝同时声明 Content-Length 和 Transfer-Encoding", async () => {
    process.env.DEMO_MODE = "1";
    const request = new NextRequest("http://x/api/notes", {
      method: "POST",
      body: "x",
      headers: { "Content-Length": "1", "Transfer-Encoding": "chunked" },
    });
    expect((await middleware(request)).status).toBe(400);
    expect(request.bodyUsed).toBe(false);
  });

  it("带正文但无分帧头的 HTTP/2 风格请求被拒绝", async () => {
    process.env.DEMO_MODE = "1";
    const request = new NextRequest("http://x/api/notes", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("x"));
          controller.close();
        },
      }),
    });
    request.headers.delete("content-length");
    expect((await middleware(request)).status).toBe(411);
    expect(request.bodyUsed).toBe(false);
  });

  it("无长度的分块请求在读取正文前被拒绝", async () => {
    process.env.DEMO_MODE = "1";
    const request = new NextRequest("http://x/api/auth/login", {
      method: "POST",
      headers: { "Transfer-Encoding": "chunked" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("x"));
          controller.close();
        },
      }),
    });

    expect((await middleware(request)).status).toBe(411);
    expect(request.bodyUsed).toBe(false);
  });

  it("没有请求体时也拒绝超限的长度声明", async () => {
    process.env.DEMO_MODE = "1";
    const request = new NextRequest("http://x/api/healthz", {
      headers: { "Content-Length": String(200 * 1024 * 1024 + 1) },
    });

    expect((await middleware(request)).status).toBe(413);
  });

  it.each([0, 200 * 1024 * 1024])("接受合法长度边界 %i，且不消费正文", async (length) => {
    process.env.DEMO_MODE = "1";
    const request = new NextRequest("http://x/api/auth/login", {
      method: "POST",
      headers: { "Content-Length": String(length) },
      body: length === 0 ? undefined : "x",
    });

    expect((await middleware(request)).headers.get("x-middleware-next")).toBe("1");
    expect(request.bodyUsed).toBe(false);
  });

  it("无正文健康检查保持可用，普通 API 仍要求登录", async () => {
    process.env.DEMO_MODE = "1";
    expect((await middleware(new NextRequest("http://x/api/healthz"))).status).toBe(200);
    expect((await middleware(new NextRequest("http://x/api/notes"))).status).toBe(401);
  });

  it("正式模式保持无长度请求的原有行为", async () => {
    const request = new NextRequest("http://x/api/auth/login", { method: "POST", body: "{}" });
    expect((await middleware(request)).headers.get("x-middleware-next")).toBe("1");
  });

  it("Demo 中高风险路径在中间件阶段直接返回 403", async () => {
    process.env.DEMO_MODE = "1";
    const request = new NextRequest("http://x/api/settings/llm", {
      method: "DELETE",
      headers: { Cookie: `${SESSION_COOKIE}=${await createSessionToken()}` },
      body: JSON.stringify({ model: "demo" }),
    });
    const assertUnread = watchRequestBody(request);
    expect((await middleware(request)).status).toBe(403);
    assertUnread();
  });

  it("所有高风险入口在 Demo 中直接拒绝", async () => {
    process.env.DEMO_MODE = "1";
    const [llm, tokens, exportRoute, backup, embedding, importer, llmTest, uploads] = await Promise.all([
      import("@/app/api/settings/llm/route"),
      import("@/app/api/settings/tokens/route"),
      import("@/app/api/export/route"),
      import("@/app/api/backup/route"),
      import("@/app/api/embedding/backfill/route"),
      import("@/app/api/import/route"),
      import("@/app/api/llm/test/route"),
      import("@/app/api/uploads/route"),
    ]);

    const [dbModule, backupModule] = await Promise.all([import("@/db"), import("@/lib/backup")]);
    const failOnSideEffect = () => { throw new Error("Demo 拒绝前不应执行业务副作用"); };
    const sideEffects = [
      vi.spyOn(dbModule, "getDb").mockImplementation(failOnSideEffect),
      vi.spyOn(dbModule, "getSqlite").mockImplementation(failOnSideEffect),
      vi.spyOn(backupModule, "doBackup").mockImplementation(failOnSideEffect),
      vi.spyOn(fs, "writeFileSync").mockImplementation(failOnSideEffect),
      vi.spyOn(fs, "createWriteStream").mockImplementation(failOnSideEffect),
      vi.fn(failOnSideEffect),
    ];
    vi.stubGlobal("fetch", sideEffects.at(-1));
    const bodyChecks: Array<() => void> = [];
    const req = (url: string, method: string, body?: BodyInit, headers?: HeadersInit) => {
      const request = new NextRequest(`http://x${url}`, { method, body, headers });
      bodyChecks.push(watchRequestBody(request));
      return request;
    };
    // 导入接收原始 ZIP 流，上传接收 multipart；两种夹具均包含真实且非空的文件。
    const importBody = await createImportBody();
    expect(importBody.byteLength).toBeGreaterThan(0);
    const importRequest = req("/api/import", "POST", new Uint8Array(importBody), { "Content-Type": "application/zip" });
    const uploadRequest = req("/api/uploads", "POST", createUploadBody());
    expect(importRequest.body).not.toBeNull();
    expect(uploadRequest.body).not.toBeNull();
    expect(uploadRequest.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    expect((await llm.PATCH(req("/api/settings/llm", "PATCH", "{}"))).status).toBe(403);
    expect((await llm.DELETE()).status).toBe(403);
    expect((await tokens.GET()).status).toBe(403);
    expect((await tokens.POST(req("/api/settings/tokens", "POST", "{}"))).status).toBe(403);
    expect((await tokens.DELETE(req("/api/settings/tokens?id=x", "DELETE"))).status).toBe(403);
    expect((await exportRoute.GET()).status).toBe(403);
    expect((await backup.POST()).status).toBe(403);
    expect((await embedding.GET()).status).toBe(403);
    expect((await embedding.POST()).status).toBe(403);
    expect((await importer.POST(importRequest)).status).toBe(403);
    expect((await llmTest.POST(req("/api/llm/test", "POST", "{}"))).status).toBe(403);
    expect((await uploads.POST(uploadRequest)).status).toBe(403);
    for (const sideEffect of sideEffects) expect(sideEffect).not.toHaveBeenCalled();
    for (const assertUnread of bodyChecks) assertUnread();
  }, 15_000);

  it("高风险拒绝发生在业务副作用之前", async () => {
    process.env.DEMO_MODE = "1";
    const backupModule = await import("@/lib/backup");
    const dbModule = await import("@/db");
    const backupSpy = vi.spyOn(backupModule, "doBackup");
    const dbSpy = vi.spyOn(dbModule, "getDb");
    const [{ POST: backupPost }, { DELETE: deleteLlm }] = await Promise.all([
      import("@/app/api/backup/route"),
      import("@/app/api/settings/llm/route"),
    ]);

    expect((await backupPost()).status).toBe(403);
    expect((await deleteLlm()).status).toBe(403);
    expect(backupSpy).not.toHaveBeenCalled();
    expect(dbSpy).not.toHaveBeenCalled();
    backupSpy.mockRestore();
    dbSpy.mockRestore();
  });

  it("Demo 设置页传给客户端的文本模型接入点不含内部 mock 地址", async () => {
    process.env.DEMO_MODE = "1";
    const { getLlmBaseUrlForClient, getLlmConfig } = await import("@/lib/llm-config");
    expect(getLlmBaseUrlForClient(getLlmConfig(), true)).toBe("");
    expect(getLlmBaseUrlForClient({ baseUrl: "https://api.example.test/v1" }, false)).toBe("https://api.example.test/v1");
  });

  it("普通文本笔记允许进入主流程，不被 Demo 守卫误拒绝", async () => {
    process.env.DEMO_MODE = "1";
    const { POST } = await import("@/app/api/notes/route");
    const content = JSON.stringify({ content: "Demo 边界测试笔记" });
    const request = new NextRequest("http://x/api/notes", {
      method: "POST",
      body: content,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(content)),
        Cookie: `${SESSION_COOKIE}=${await createSessionToken()}`,
      },
    });
    expect((await middleware(request)).headers.get("x-middleware-next")).toBe("1");
    const response = await POST(request);
    expect(response.status).toBe(201);
  });
});
