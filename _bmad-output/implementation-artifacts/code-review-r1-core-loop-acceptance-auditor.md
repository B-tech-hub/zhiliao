You are an Acceptance Auditor. Review the provided diff against D:/ClaudeProjects/ai_acknowladge/_bmad-output/implementation-artifacts/spec-r1-core-loop.md and any loaded context docs. Check for: violations of acceptance criteria, deviations from spec intent, missing implementation of specified behavior, contradictions between spec constraints and actual code. Output findings as a Markdown list. Each finding: one-line title, which AC/constraint it violates, and evidence from the diff.

Diff:

diff --git a/src/app/api/chat/confirm/route.ts b/src/app/api/chat/confirm/route.ts
index 01cd821..4a98d3f 100644
--- a/src/app/api/chat/confirm/route.ts
+++ b/src/app/api/chat/confirm/route.ts
@@ -154,5 +154,6 @@ export async function POST(req: NextRequest) {
         },
       },
     ],
+    sourceRefusal: grounded,
   });
 }
diff --git a/src/app/api/chat/route.ts b/src/app/api/chat/route.ts
index df4c4c1..bf8c036 100644
--- a/src/app/api/chat/route.ts
+++ b/src/app/api/chat/route.ts
@@ -203,5 +203,6 @@ export async function POST(req: NextRequest) {
     prelude: grounded
       ? [{ grounding: { noteIds: allowedNoteIds ?? [], mode: sourcesMode ?? "empty" } }]
       : undefined,
+    sourceRefusal: grounded,
   });
 }
diff --git a/src/components/chat/chat-state.ts b/src/components/chat/chat-state.ts
index 9119981..aaeeb01 100644
--- a/src/components/chat/chat-state.ts
+++ b/src/components/chat/chat-state.ts
@@ -262,8 +262,10 @@ export interface CitationSegment {
   // 有值表示这一段是可跳转的引用标记
   noteId?: string;
 }
-// 笔记 id 是 cuid2（小写字母数字），放宽到 \w- 以兼容手工造的 id
-const CITATION_RE = /\[\^([A-Za-z0-9_-]+)\]/g;
+// 笔记 id 是 cuid2（小写字母数字），放宽到字母数字、下划线和连字符。
+// 正式写法是 [^id]。模型有时会把占位说明抄进去，写成 [^noteId:id]。
+// 冒号前只认这个固定前缀，取出来的 id 仍要过白名单。
+const CITATION_RE = /\[\^(?:noteId:)?([A-Za-z0-9_-]+)\]/g;
 
 /* 把正文按引用标记切段。白名单外的标记连同前后文并成普通文本——
    模型会编造 id，渲染成链接点进去是 404，不如保持原样：
diff --git a/src/lib/ai/chat-context.ts b/src/lib/ai/chat-context.ts
index 923c83b..f411daa 100644
--- a/src/lib/ai/chat-context.ts
+++ b/src/lib/ai/chat-context.ts
@@ -4,6 +4,7 @@
 import { and, desc, eq, isNull } from "drizzle-orm";
 import { getDb } from "@/db";
 import { notes, topics } from "@/db/schema";
+import { SOURCE_REFUSAL_SENTENCE } from "@/lib/ai/source-refusal";
 import { buildSourcesContext } from "@/lib/ai/sources";
 import { extractImageFilenames } from "@/lib/image-refs";
 import { isFeatureEnabled } from "@/lib/feature-flags";
@@ -43,7 +44,7 @@ export const SOURCES_SYSTEM_PROMPT = `你是「知了」个人知识库的 AI 
 
 严格接地（最高优先级，不可协商）：
 - 你的回答只能依据下面给出的来源集内容，以及用 search_notes / read_note 从来源集内取到的内容
-- 来源集里没有的信息，一律回答「来源笔记中没有相关内容」，并简要说明缺什么。禁止用你自己的知识补充、推测或发挥
+- 来源集里没有的信息，一律回答「${SOURCE_REFUSAL_SENTENCE}」，并简要说明缺什么。禁止用你自己的知识补充、推测或发挥
 - 即使用户明确要求你用自身知识回答，也不要在本次会话中破例。请告诉他：本次是来源问答，可以新建一个普通对话来问
 - 允许对来源内容做归纳、比较、改写和总结，但结论必须能在来源里找到依据
 
diff --git a/src/lib/ai/chat-stream.ts b/src/lib/ai/chat-stream.ts
index e7e3012..faa2833 100644
--- a/src/lib/ai/chat-stream.ts
+++ b/src/lib/ai/chat-stream.ts
@@ -7,6 +7,7 @@ import type { DB } from "@/db";
 import { conversations, messages, notes } from "@/db/schema";
 import { newId } from "@/lib/ids";
 import type { LlmMessage } from "@/lib/llm";
+import { enforceSourceRefusal } from "./source-refusal";
 import {
   LIMIT_NOTICE,
   OVER_LIMIT_RESULT,
@@ -26,6 +27,8 @@ export interface ChatStreamParams {
   deps: ToolLoopDeps;
   // 循环开始前先发出的事件（确认后补发那条已执行的工具结果）
   prelude?: unknown[];
+  // 来源问答：资料不足的最终回答强制带上固定拒答句
+  sourceRefusal?: boolean;
 }
 
 export function createChatSseResponse(params: ChatStreamParams): Response {
@@ -63,26 +66,31 @@ export function createChatSseResponse(params: ChatStreamParams): Response {
         for await (const ev of runToolLoop(initial, deps)) {
           switch (ev.kind) {
             case "delta":
-              send({ delta: ev.text });
+              // 来源问答先攒着，最终回答收口后再一次性发出，避免客户端拼出改写前的句子
+              if (!params.sourceRefusal) send({ delta: ev.text });
               break;
 
             case "reasoning":
               send({ reasoning: ev.text });
               break;
 
-            case "assistant":
+            case "assistant": {
               /* 空轮（既无文本又无调用）不落库，避免历史里堆空消息。
                  只有思考过程没有正文的轮次同样跳过——那段思考属于
-                 紧接着的工具调用轮，不该单独留一条空消息 */
-              if (ev.text || ev.calls.length > 0) {
+                 紧接着的工具调用轮，不该单独留一条空消息。
+                 只收口没有工具调用的最终回答；查资料过程中的过渡句不改。 */
+              const text = params.sourceRefusal && ev.calls.length === 0 ? enforceSourceRefusal(ev.text) : ev.text;
+              if (params.sourceRefusal && text) send({ delta: text });
+              if (text || ev.calls.length > 0) {
                 insert(
                   "assistant",
-                  ev.text,
+                  text,
                   ev.calls.length > 0 ? { kind: "calls", calls: ev.calls } : undefined,
                   ev.reasoning,
                 );
               }
               break;
+            }
 
             case "tool_start":
               send({ tool_start: { id: ev.call.id, name: ev.call.name, args: ev.call.args } });
diff --git a/tests/lib/chat-state.test.ts b/tests/lib/chat-state.test.ts
index a6c3be0..0926cd3 100644
--- a/tests/lib/chat-state.test.ts
+++ b/tests/lib/chat-state.test.ts
@@ -381,6 +381,21 @@ describe("splitCitations 引用溯源", () => {
   it("空文本返回空数组", () => {
     expect(splitCitations("", new Set())).toEqual([]);
   });
+
+  it("模型写成 noteId 前缀时仍取出真实 id", () => {
+    const segs = splitCitations("安排在周二[^noteId:n1]。", new Set(["n1"]));
+    expect(segs).toEqual([
+      { text: "安排在周二" },
+      { text: "[^noteId:n1]", noteId: "n1" },
+      { text: "。" },
+    ]);
+  });
+
+  it("带前缀但 id 不在白名单时保持原样", () => {
+    expect(splitCitations("据说如此[^noteId:n404]。", new Set(["n1"]))).toEqual([
+      { text: "据说如此[^noteId:n404]。" },
+    ]);
+  });
 });
 
 /* 助手回答改走 Markdown 渲染后，`[^id]` 正好撞上 GFM 的脚注语法——
@@ -409,6 +424,12 @@ describe("citationsToMarkdown 引用转链接", () => {
   it("没有引用的正文原样通过", () => {
     expect(citationsToMarkdown("## 标题\n\n- 列表", new Set())).toBe("## 标题\n\n- 列表");
   });
+
+  it("noteId 前缀的真实引用变成同一条站内链接", () => {
+    expect(citationsToMarkdown("A[^noteId:n1]B[^n2]", new Set(["n1", "n2"]))).toBe(
+      "A[[1]](/notes/n1)B[[2]](/notes/n2)",
+    );
+  });
 });
 
 describe("pumpSseEvents", () => {
diff --git a/tests/lib/chat-stream.test.ts b/tests/lib/chat-stream.test.ts
index 30a990b..4882918 100644
--- a/tests/lib/chat-stream.test.ts
+++ b/tests/lib/chat-stream.test.ts
@@ -32,7 +32,7 @@ function seedConversation() {
 // 跑一次流并把 SSE 文本解析成事件对象数组
 async function collectSse(
   rounds: StreamChunk[][],
-  opts: { outcome?: ToolOutcome; startSeq?: number } = {},
+  opts: { outcome?: ToolOutcome; startSeq?: number; sourceRefusal?: boolean } = {},
 ) {
   let i = 0;
   const deps: ToolLoopDeps = {
@@ -51,6 +51,7 @@ async function collectSse(
     signal: new AbortController().signal,
     initial: [{ role: "user", content: "帮我记一条" }],
     deps,
+    sourceRefusal: opts.sourceRefusal,
   });
   const body = await res.text();
   return body
@@ -189,3 +190,24 @@ describe("轮次上限", () => {
     expect(last.content).toContain("轮次上限");
   });
 });
+
+describe("来源拒答收口", () => {
+  it("最终回答里的改写拒答会收成固定句，并按收口后的文本落库", async () => {
+    const events = await collectSse(
+      [[text("来源笔记中没有关于茶树种植环境的相关内容。")]],
+      { sourceRefusal: true },
+    );
+    const deltas = events.filter((e) => e.delta).map((e) => (e.delta as string));
+    expect(deltas.join("")).toContain("来源笔记中没有相关内容");
+    expect(deltas.join("")).not.toContain("没有关于");
+    expect(storedMessages().at(-1)?.content).toContain("来源笔记中没有相关内容");
+  });
+
+  it("带引用的回答不收成拒答", async () => {
+    const answer = "羽毛球练习安排在每周二早上[^note-a]。";
+    const events = await collectSse([[text(answer)]], { sourceRefusal: true });
+    const deltas = events.filter((e) => e.delta).map((e) => e.delta as string);
+    expect(deltas.join("")).toBe(answer);
+    expect(storedMessages().at(-1)?.content).toBe(answer);
+  });
+});
diff --git a/scripts/verify-r1-core-loop.mjs b/scripts/verify-r1-core-loop.mjs
new file mode 100644
index 0000000..700a262
--- /dev/null
+++ b/scripts/verify-r1-core-loop.mjs
@@ -0,0 +1,1018 @@
+// R1 核心闭环：对已启动的隔离实例做 HTTP 编排。
+// 合成数据、真实文本模型、证据脱敏。不读取正式 data/ 笔记。
+import crypto from "node:crypto";
+import fs from "node:fs";
+import os from "node:os";
+import net from "node:net";
+import path from "node:path";
+import { createRequire } from "node:module";
+import { execFileSync, spawn } from "node:child_process";
+import { fileURLToPath, pathToFileURL } from "node:url";
+
+const require = createRequire(import.meta.url);
+
+const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
+const DATA_ROOT = path.join(ROOT, "data-r1-core");
+const DIST_DIR = ".next-r1-core";
+const NO_MODEL_EVIDENCE = "docs/R1安装验收-2026-09-15.md";
+const INBOX_TOPIC_ID = "inbox";
+const INVALID_KEY = "sk-r1-invalid-not-a-real-key";
+const HEALTH_TIMEOUT_MS = 180000;
+const ORGANIZE_TIMEOUT_MS = 480000;
+const CHAT_TIMEOUT_MS = 120000;
+const FAILURE_TIMEOUT_MS = 45000;
+const RUN_SLACK_MS = 120000;
+const ORGANIZE_RECOVERY_MS = ORGANIZE_TIMEOUT_MS;
+export const RUN_DEADLINE_MS = HEALTH_TIMEOUT_MS + ORGANIZE_TIMEOUT_MS + ORGANIZE_RECOVERY_MS + CHAT_TIMEOUT_MS * 2 + FAILURE_TIMEOUT_MS + RUN_SLACK_MS;
+export const SLEEP_GAP_MS = 5000;
+
+let runGuard = null;
+
+export const FIXTURES = {
+  topic: "运动",
+  notes: {
+    A: "每周二早上在体育馆覆盖练习羽毛球远球",
+    B: "Markdown 表格用 `:---` 左对齐、`:---:` 居中、`---:` 右对齐",
+    C: "光合作用需要叶绿素吸收光能",
+  },
+  citeQuestion: "羽毛球练习安排在星期几",
+  refuseQuestion: "茶树在什么环境种植",
+  searchTerms: {
+    A: "羽毛球",
+    B: "Markdown 表格",
+    C: "叶绿素",
+  },
+};
+
+function parseEnvFile(filePath, bag) {
+  if (!fs.existsSync(filePath)) return bag;
+  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
+    const line = raw.trim();
+    if (!line || line.startsWith("#")) continue;
+    const eq = line.indexOf("=");
+    if (eq <= 0) continue;
+    const key = line.slice(0, eq).trim();
+    let value = line.slice(eq + 1).trim();
+    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
+      value = value.slice(1, -1);
+    }
+    bag[key] = value;
+  }
+  return bag;
+}
+
+function loadDotenv() {
+  const bag = {};
+  parseEnvFile(path.join(ROOT, ".env"), bag);
+  parseEnvFile(path.join(ROOT, ".env.local"), bag);
+  return { ...bag, ...process.env };
+}
+
+function redact(text, secrets) {
+  let out = String(text ?? "");
+  for (const secret of secrets) {
+    if (!secret) continue;
+    out = out.split(secret).join("[REDACTED]");
+  }
+  out = out.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[REDACTED]");
+  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]");
+  return out;
+}
+
+function sha256File(filePath) {
+  const hash = crypto.createHash("sha256");
+  hash.update(fs.readFileSync(filePath));
+  return hash.digest("hex");
+}
+
+function hashTree(dir) {
+  if (!fs.existsSync(dir)) return { exists: false, files: 0, digest: null };
+  const files = [];
+  const walk = (current) => {
+    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
+      const full = path.join(current, entry.name);
+      if (entry.isDirectory()) walk(full);
+      else if (entry.isFile()) {
+        const rel = path.relative(dir, full).split(path.sep).join("/");
+        files.push(`${rel}:${sha256File(full)}:${fs.statSync(full).size}`);
+      }
+    }
+  };
+  walk(dir);
+  files.sort();
+  const digest = crypto.createHash("sha256").update(files.join("\n")).digest("hex");
+  return { exists: true, files: files.length, digest };
+}
+
+function sleep(ms) {
+  return new Promise((resolve) => setTimeout(resolve, ms));
+}
+
+export function sleepGapMs(wallMs, monoMs) {
+  return wallMs - monoMs;
+}
+
+export function sleepDetected(wallMs, monoMs, thresholdMs = SLEEP_GAP_MS) {
+  return sleepGapMs(wallMs, monoMs) >= thresholdMs;
+}
+
+function clockNow() {
+  return { wall: Date.now(), mono: Number(process.hrtime.bigint() / 1000000n) };
+}
+
+export function parseStandbyIndexes(text) {
+  const read = (pattern) => {
+    const match = pattern.exec(text);
+    if (!match) return null;
+    const raw = match[1];
+    return raw.toLowerCase().startsWith("0x") ? Number.parseInt(raw, 16) : Number.parseInt(raw, 10);
+  };
+  return {
+    ac_sec: read(/(?:当前交流电源设置索引|Current AC Power Setting Index)\s*:\s*(0x[0-9a-fA-F]+|\d+)/i),
+    dc_sec: read(/(?:当前直流电源设置索引|Current DC Power Setting Index)\s*:\s*(0x[0-9a-fA-F]+|\d+)/i),
+  };
+}
+
+function decodeCommand(buf) {
+  const utf8 = buf.toString("utf8");
+  if (utf8.includes("当前交流电源设置索引") || utf8.includes("Current AC Power Setting Index")) return utf8;
+  try {
+    return new TextDecoder("gbk").decode(buf);
+  } catch {
+    return utf8;
+  }
+}
+
+function readStandbyTimeouts() {
+  if (process.platform !== "win32") return { available: false, ac_sec: null, dc_sec: null };
+  try {
+    const buf = execFileSync("powercfg", ["/query", "SCHEME_CURRENT", "SUB_SLEEP", "STANDBYIDLE"], { windowsHide: true });
+    const parsed = parseStandbyIndexes(decodeCommand(buf));
+    return { available: parsed.ac_sec != null || parsed.dc_sec != null, ...parsed };
+  } catch {
+    return { available: false, ac_sec: null, dc_sec: null };
+  }
+}
+
+function formatStandby(sec) {
+  if (sec == null) return "未知";
+  if (sec === 0) return "从不";
+  if (sec % 60 === 0) return `${sec / 60} 分钟`;
+  return `${sec} 秒`;
+}
+
+function printPowerReminder(info) {
+  if (!info.available) {
+    console.log("未能读取电源计划的睡眠超时。请在本轮保持机器不睡眠。");
+    return;
+  }
+  console.log(`当前电源计划待机超时：交流 ${formatStandby(info.ac_sec)}，直流 ${formatStandby(info.dc_sec)}。脚本会申请保持唤醒；请不要合盖或手动睡眠。整体截止 ${RUN_DEADLINE_MS}ms。`);
+}
+
+const KEEP_AWAKE_PS = [
+  "$ErrorActionPreference = 'Stop'",
+  "Add-Type -TypeDefinition @\"",
+  "using System;",
+  "using System.Runtime.InteropServices;",
+  "public static class R1StayAwake {",
+  "  [DllImport(\"kernel32.dll\")]",
+  "  public static extern uint SetThreadExecutionState(uint esFlags);",
+  "}",
+  "\"@",
+  "$flags = [uint32]2147483648 -bor [uint32]1",
+  "[void][R1StayAwake]::SetThreadExecutionState($flags)",
+  "Write-Output 'ready'",
+  "while ($true) {",
+  "  [void][R1StayAwake]::SetThreadExecutionState($flags)",
+  "  Start-Sleep -Seconds 20",
+  "}",
+].join("\r\n");
+
+function stayAwakeScriptPath() {
+  return path.join(os.tmpdir(), "zhiliao-r1-stay-awake.ps1");
+}
+
+function startKeepAwake() {
+  if (process.platform !== "win32") return Promise.resolve(null);
+  const scriptPath = stayAwakeScriptPath();
+  ensureDir(path.dirname(scriptPath));
+  fs.writeFileSync(scriptPath, KEEP_AWAKE_PS, "utf8");
+  return new Promise((resolve, reject) => {
+    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
+      windowsHide: true,
+      stdio: ["ignore", "pipe", "pipe"],
+    });
+    let stdout = "";
+    let stderr = "";
+    let settled = false;
+    let timer;
+    const finish = (err, value) => {
+      if (settled) return;
+      settled = true;
+      clearTimeout(timer);
+      if (err) reject(err);
+      else resolve(value);
+    };
+    timer = setTimeout(() => {
+      stopKeepAwake(child);
+      finish(new Error("保持唤醒进程未在 5 秒内就绪"));
+    }, 5000);
+    child.stdout.on("data", (buf) => {
+      stdout += buf.toString("utf8");
+      if (stdout.includes("ready")) finish(null, child);
+    });
+    child.stderr.on("data", (buf) => {
+      stderr += buf.toString("utf8");
+    });
+    child.once("exit", (code) => {
+      finish(new Error(`保持唤醒进程退出 ${code}：${stderr.slice(0, 400) || stdout.slice(0, 400)}`));
+    });
+  });
+}
+
+function stopKeepAwake(child) {
+  if (child && child.exitCode == null) {
+    try {
+      if (process.platform === "win32") {
+        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
+      } else {
+        child.kill("SIGTERM");
+      }
+    } catch {}
+  }
+  try { fs.rmSync(stayAwakeScriptPath(), { force: true }); } catch {}
+}
+
+function createRunGuard(summary) {
+  const origin = clockNow();
+  const ac = new AbortController();
+  const state = { wall_ms: 0, mono_ms: 0, sleep_gap_ms: 0, sleep_detected: false };
+  function sample() {
+    const now = clockNow();
+    const wallMs = now.wall - origin.wall;
+    const monoMs = now.mono - origin.mono;
+    const gapMs = sleepGapMs(wallMs, monoMs);
+    state.wall_ms = wallMs;
+    state.mono_ms = monoMs;
+    state.sleep_gap_ms = Math.max(state.sleep_gap_ms, gapMs);
+    state.sleep_detected = state.sleep_detected || sleepDetected(wallMs, monoMs);
+    summary.clock = {
+      wall_ms: state.wall_ms,
+      mono_ms: state.mono_ms,
+      sleep_gap_ms: state.sleep_gap_ms,
+      sleep_detected: state.sleep_detected,
+      deadline_ms: RUN_DEADLINE_MS,
+    };
+    return state;
+  }
+  function fail(message) {
+    const error = new Error(message);
+    if (!ac.signal.aborted) ac.abort(error);
+    throw error;
+  }
+  function assertRunning() {
+    const current = sample();
+    if (current.sleep_detected) {
+      fail(`检测到机器睡眠：墙钟比单调时钟多 ${current.sleep_gap_ms}ms，本轮中止且不重试`);
+    }
+    if (current.wall_ms >= RUN_DEADLINE_MS) {
+      fail(`超过整体截止 ${RUN_DEADLINE_MS}ms，本轮中止且不重试`);
+    }
+  }
+  const timer = setInterval(() => {
+    try { assertRunning(); } catch {}
+  }, 2000);
+  timer.unref?.();
+  return {
+    signal: ac.signal,
+    sample,
+    assertRunning,
+    stop() {
+      clearInterval(timer);
+      sample();
+    },
+  };
+}
+
+function anySignal(signals) {
+  const live = signals.filter(Boolean);
+  if (typeof AbortSignal.any === "function") return AbortSignal.any(live);
+  const ac = new AbortController();
+  for (const signal of live) {
+    if (signal.aborted) {
+      ac.abort(signal.reason);
+      return ac.signal;
+    }
+    signal.addEventListener("abort", () => ac.abort(signal.reason), { once: true });
+  }
+  return ac.signal;
+}
+
+function throwIfRunAborted() {
+  const signal = runGuard?.signal;
+  if (!signal?.aborted) return;
+  const reason = signal.reason;
+  if (reason instanceof Error) throw reason;
+  throw new Error(typeof reason === "string" ? reason : "本轮已中止");
+}
+
+function findFreePort(preferred) {
+  return new Promise((resolve, reject) => {
+    const probe = (port, fallback) => {
+      const server = net.createServer();
+      server.unref();
+      server.on("error", () => {
+        if (fallback) fallback();
+        else reject(new Error("无可用端口"));
+      });
+      server.listen(port, "127.0.0.1", () => {
+        server.close(() => resolve(port));
+      });
+    };
+    probe(preferred, () => {
+      const server = net.createServer();
+      server.unref();
+      server.on("error", reject);
+      server.listen(0, "127.0.0.1", () => {
+        const port = server.address().port;
+        server.close(() => resolve(port));
+      });
+    });
+  });
+}
+
+function cookieHeader(jar) {
+  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
+}
+
+function absorbSetCookie(res, jar) {
+  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
+  for (const item of raw) {
+    const pair = item.split(";")[0];
+    const eq = pair.indexOf("=");
+    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1);
+  }
+}
+
+async function jsonRequest(baseUrl, jar, method, apiPath, body, timeoutMs = 30000) {
+  runGuard?.assertRunning();
+  const url = new URL(apiPath, baseUrl);
+  const headers = { Accept: "application/json" };
+  if (jar && Object.keys(jar).length) headers.Cookie = cookieHeader(jar);
+  let payload;
+  if (body !== undefined) {
+    payload = JSON.stringify(body);
+    headers["Content-Type"] = "application/json";
+  }
+  const ac = new AbortController();
+  const timer = setTimeout(() => ac.abort(), timeoutMs);
+  try {
+    const res = await fetch(url, {
+      method,
+      headers,
+      body: payload,
+      signal: anySignal([ac.signal, runGuard?.signal]),
+    });
+    absorbSetCookie(res, jar);
+    const text = await res.text();
+    let json = null;
+    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 2000) }; }
+    return { status: res.status, json, text };
+  } catch (error) {
+    throwIfRunAborted();
+    if (error instanceof Error && error.name === "AbortError") {
+      throw new Error(`请求超时 ${timeoutMs}ms：${method} ${apiPath}`);
+    }
+    throw error;
+  } finally {
+    clearTimeout(timer);
+  }
+}
+
+function parseSseBuffer(buffer, events) {
+  const parts = buffer.split("\n\n");
+  const rest = parts.pop() ?? "";
+  for (const block of parts) {
+    for (const line of block.split("\n")) {
+      if (!line.startsWith("data:")) continue;
+      const data = line.slice(5).trim();
+      if (!data) continue;
+      try { events.push(JSON.parse(data)); } catch { events.push({ raw: data }); }
+    }
+  }
+  return rest;
+}
+
+async function chatSse(baseUrl, jar, body, timeoutMs = CHAT_TIMEOUT_MS) {
+  runGuard?.assertRunning();
+  const url = new URL("/api/chat", baseUrl);
+  const ac = new AbortController();
+  const timer = setTimeout(() => ac.abort(), timeoutMs);
+  try {
+    const res = await fetch(url, {
+      method: "POST",
+      headers: {
+        Accept: "text/event-stream",
+        "Content-Type": "application/json",
+        Cookie: cookieHeader(jar),
+      },
+      body: JSON.stringify(body),
+      signal: anySignal([ac.signal, runGuard?.signal]),
+    });
+    absorbSetCookie(res, jar);
+    if (!res.ok || !res.body) {
+      const text = await res.text();
+      throw new Error(`来源问答 HTTP ${res.status}: ${text.slice(0, 500)}`);
+    }
+    const events = [];
+    const reader = res.body.getReader();
+    const decoder = new TextDecoder();
+    let buffer = "";
+    for (;;) {
+      throwIfRunAborted();
+      const { done, value } = await reader.read();
+      if (done) break;
+      buffer += decoder.decode(value, { stream: true });
+      buffer = parseSseBuffer(buffer, events);
+    }
+    if (buffer) parseSseBuffer(buffer + "\n\n", events);
+    const text = events.filter((e) => typeof e.delta === "string").map((e) => e.delta).join("");
+    const grounding = events.find((e) => e && e.grounding)?.grounding ?? null;
+    const doneEv = events.find((e) => e && e.done);
+    const errorEv = events.find((e) => e && e.error);
+    return { status: res.status, events, text, grounding, conversationId: doneEv?.conversationId ?? null, error: errorEv?.error ?? null };
+  } catch (error) {
+    throwIfRunAborted();
+    if (error instanceof Error && error.name === "AbortError") {
+      throw new Error(`来源问答超过 ${timeoutMs}ms，已留证且不重试`);
+    }
+    throw error;
+  } finally {
+    clearTimeout(timer);
+  }
+}
+
+async function waitHealth(baseUrl, timeoutMs, child) {
+  const started = Date.now();
+  let last = "";
+  while (Date.now() - started < timeoutMs) {
+    runGuard?.assertRunning();
+    if (child.exitCode != null) {
+      throw new Error(`隔离实例启动失败，退出码 ${child.exitCode}${last ? `：${last}` : ""}`);
+    }
+    try {
+      const res = await jsonRequest(baseUrl, {}, "GET", "/api/healthz", undefined, 3000);
+      if (res.status === 200 && res.json?.ok) return res;
+      last = `HTTP ${res.status}`;
+    } catch (e) {
+      throwIfRunAborted();
+      last = e instanceof Error ? e.message : String(e);
+      if (last.includes("检测到机器睡眠") || last.includes("超过整体截止")) throw e;
+    }
+    await sleep(500);
+  }
+  throw new Error(`隔离实例启动超时${last ? `：${last}` : ""}`);
+}
+
+function spawnApp(env, logFile) {
+  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
+  const out = fs.openSync(logFile, "w");
+  const child = spawn(process.execPath, [nextBin, "dev", "--turbopack", "--port", String(env.PORT)], {
+    cwd: ROOT,
+    env,
+    stdio: ["ignore", out, out],
+    windowsHide: true,
+  });
+  child.once("exit", () => {
+    try { fs.closeSync(out); } catch {}
+  });
+  return child;
+}
+
+function killTree(child) {
+  if (!child || child.exitCode != null) return;
+  try {
+    if (process.platform === "win32") {
+      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
+    } else {
+      child.kill("SIGTERM");
+    }
+  } catch {}
+}
+
+
+function loadTextLlm(envBag) {
+  const fromEnv = {
+    baseUrl: (envBag.LLM_BASE_URL || "").trim(),
+    apiKey: (envBag.LLM_API_KEY || "").trim(),
+    model: (envBag.LLM_MODEL || "").trim(),
+  };
+  if (fromEnv.baseUrl && fromEnv.apiKey && fromEnv.model) {
+    return { ...fromEnv, source: "env" };
+  }
+  // 只读宿主 settings 三项，不查 notes，不改写 data/
+  const hostDb = envBag.DATABASE_PATH || path.join(ROOT, "data", "db", "app.db");
+  const Database = require("better-sqlite3");
+  const db = new Database(hostDb, { readonly: true, fileMustExist: true });
+  try {
+    const rows = db.prepare("select key, value from settings where key in ('llm_base_url','llm_api_key','llm_model')").all();
+    const map = Object.fromEntries(rows.map((row) => [row.key, (row.value || "").trim()]));
+    return {
+      baseUrl: fromEnv.baseUrl || map.llm_base_url || "",
+      apiKey: fromEnv.apiKey || map.llm_api_key || "",
+      model: fromEnv.model || map.llm_model || "",
+      source: "host-settings",
+    };
+  } finally {
+    db.close();
+  }
+}
+
+function readLlmMeta(cfg) {
+  let host = "";
+  try { host = cfg.baseUrl ? new URL(cfg.baseUrl).host : ""; } catch { host = "invalid-url"; }
+  return { source: cfg.source, model: cfg.model, host, key_len: cfg.apiKey.length, configured: Boolean(cfg.baseUrl && cfg.apiKey && cfg.model) };
+}
+
+function assert(condition, message) {
+  if (!condition) throw new Error(message);
+}
+
+function spendBudget(summary, key) {
+  summary.budget[key] += 1;
+  const cap = summary.budget.caps[key];
+  if (summary.budget[key] > cap) {
+    throw new Error(`超出批准预算 ${key}：${summary.budget[key]}/${cap}，本轮中止且不重试`);
+  }
+}
+
+function collectSearchIds(res) {
+  return (res.json?.results ?? []).map((row) => row.id);
+}
+
+async function pollNote(baseUrl, jar, noteId, timeoutMs, want) {
+  const started = Date.now();
+  let last = null;
+  for (;;) {
+    runGuard?.assertRunning();
+    const res = await jsonRequest(baseUrl, jar, "GET", `/api/notes/${noteId}`);
+    last = res.json?.note ?? null;
+    if (last && want.includes(last.aiStatus)) {
+      return { note: last, elapsedMs: Date.now() - started, timedOut: false };
+    }
+    if (Date.now() - started >= timeoutMs) {
+      return { note: last, elapsedMs: Date.now() - started, timedOut: true };
+    }
+    await sleep(1000);
+  }
+}
+
+async function pollOrganize(baseUrl, jar, noteIds, timeoutMs) {
+  const started = Date.now();
+  const organized = {};
+  for (;;) {
+    runGuard?.assertRunning();
+    let pending = false;
+    for (const key of Object.keys(noteIds)) {
+      if (organized[key] && ["done", "failed"].includes(organized[key].aiStatus)) continue;
+      const res = await jsonRequest(baseUrl, jar, "GET", `/api/notes/${noteIds[key]}`);
+      const note = res.json?.note ?? null;
+      organized[key] = {
+        id: noteIds[key],
+        aiStatus: note?.aiStatus ?? null,
+        title: note?.title ?? null,
+        topicId: note?.topicId ?? null,
+        contentUnchanged: note?.content === FIXTURES.notes[key],
+        elapsedMs: Date.now() - started,
+        timedOut: false,
+      };
+      if (!["done", "failed"].includes(organized[key].aiStatus)) pending = true;
+    }
+    if (!pending) return organized;
+    if (Date.now() - started >= timeoutMs) {
+      for (const key of Object.keys(organized)) {
+        if (!["done", "failed"].includes(organized[key].aiStatus)) organized[key].timedOut = true;
+      }
+      return organized;
+    }
+    await sleep(1000);
+  }
+}
+
+export function isTransientOrganizeError(message) {
+  const text = String(message || "");
+  return /HTTP\s*429|HTTP\s*5\d\d|\btimeout\b|timed out|aborted|负载已饱和/i.test(text);
+}
+
+function latestProcessError(noteId) {
+  const Database = require("better-sqlite3");
+  const db = new Database(path.join(DATA_ROOT, "db", "app.db"), { readonly: true, fileMustExist: true, timeout: 5000 });
+  try {
+    return db.prepare(
+      "select last_error as lastError, status, attempts from ai_jobs where note_id = ? and type = 'note_process' order by updated_at desc limit 1",
+    ).get(noteId) ?? null;
+  } finally {
+    db.close();
+  }
+}
+
+// 真实 Key 下，队列三次瞬时失败后只补整理一次。不等 10 分钟退避，成功数仍由预算封顶。
+async function recoverOneTransientOrganize(baseUrl, jar, noteIds, organized) {
+  const key = ["A", "B", "C"].find((item) => organized[item]?.aiStatus === "failed" && organized[item]?.contentUnchanged === true);
+  if (!key) return null;
+  const priorError = latestProcessError(noteIds[key])?.lastError || "";
+  if (!isTransientOrganizeError(priorError)) {
+    organized[key].recoverySkipped = "非瞬时失败，不补整理";
+    return null;
+  }
+  const res = await jsonRequest(baseUrl, jar, "POST", `/api/notes/${noteIds[key]}/reprocess`);
+  assert(res.status === 200, `瞬时失败补整理 HTTP ${res.status}`);
+  const again = await pollNote(baseUrl, jar, noteIds[key], ORGANIZE_RECOVERY_MS, ["done", "failed"]);
+  const note = again.note;
+  organized[key] = {
+    id: noteIds[key],
+    aiStatus: note?.aiStatus ?? null,
+    title: note?.title ?? null,
+    topicId: note?.topicId ?? null,
+    contentUnchanged: note?.content === FIXTURES.notes[key],
+    elapsedMs: (organized[key].elapsedMs || 0) + again.elapsedMs,
+    timedOut: again.timedOut,
+    recovered: true,
+    priorError: priorError.slice(0, 300),
+  };
+  return key;
+}
+
+function disableExtraJobs() {
+  const Database = require("better-sqlite3");
+  const db = new Database(path.join(DATA_ROOT, "db", "app.db"));
+  try {
+    const now = Date.now();
+    db.prepare("insert into settings(key, value, updated_at) values ('weekly_review_enabled', '0', ?) on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at").run(now);
+    db.prepare("delete from ai_jobs where type = 'weekly_review' and status in ('pending', 'running')").run();
+  } finally {
+    db.close();
+  }
+}
+
+function ensureDir(dir) {
+  fs.mkdirSync(dir, { recursive: true });
+}
+
+function rmrf(dir) {
+  fs.rmSync(dir, { recursive: true, force: true });
+}
+
+function listDataDirs() {
+  return fs.readdirSync(ROOT, { withFileTypes: true })
+    .filter((entry) => entry.isDirectory() && (entry.name === "data" || entry.name.startsWith("data-")) && entry.name !== "data-r1-core")
+    .map((entry) => ({ name: entry.name, path: path.join(ROOT, entry.name) }))
+    .sort((a, b) => a.name.localeCompare(b.name));
+}
+
+function snapshotDataDirs() {
+  const out = {};
+  for (const item of listDataDirs()) out[item.name] = hashTree(item.path);
+  return out;
+}
+
+function compareSnapshots(before, after) {
+  const changed = [];
+  for (const name of Object.keys(before)) {
+    if (JSON.stringify(before[name]) !== JSON.stringify(after[name])) changed.push(name);
+  }
+  return changed;
+}
+
+function writeJson(filePath, value) {
+  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
+}
+
+function sanitizeLog(text, secrets) {
+  return redact(text, secrets)
+    .replaceAll(ROOT, "[REPO]")
+    .replaceAll(ROOT.replaceAll("\\", "/"), "[REPO]");
+}
+
+async function downloadZip(baseUrl, jar, destFile, timeoutMs = 30000) {
+  runGuard?.assertRunning();
+  const url = new URL("/api/export", baseUrl);
+  const ac = new AbortController();
+  const timer = setTimeout(() => ac.abort(), timeoutMs);
+  try {
+    const res = await fetch(url, { headers: { Cookie: cookieHeader(jar) }, signal: anySignal([ac.signal, runGuard?.signal]) });
+    absorbSetCookie(res, jar);
+    if (res.status !== 200) {
+      const text = await res.text();
+      throw new Error(`导出 ZIP HTTP ${res.status}: ${text.slice(0, 300)}`);
+    }
+    const buf = Buffer.from(await res.arrayBuffer());
+    fs.writeFileSync(destFile, buf);
+    const disposition = res.headers.get("content-disposition") || "";
+    const match = disposition.match(/filename="([^"]+)"/);
+    return { bytes: buf.length, filename: match?.[1] || path.basename(destFile), status: res.status };
+  } catch (error) {
+    throwIfRunAborted();
+    if (error instanceof Error && error.name === "AbortError") throw new Error("导出 ZIP 超时，已留证且不重试");
+    throw error;
+  } finally {
+    clearTimeout(timer);
+  }
+}
+
+async function main() {
+  const startedAt = new Date().toISOString();
+  const envBag = loadDotenv();
+  const llmCfg = loadTextLlm(envBag);
+  const llm = readLlmMeta(llmCfg);
+  const password = "r1-core-loop-pass";
+  const sessionSecret = crypto.randomBytes(24).toString("hex");
+  const secrets = [llmCfg.apiKey, envBag.LLM_API_KEY, envBag.APP_PASSWORD, envBag.SESSION_SECRET, password, sessionSecret, INVALID_KEY].filter(Boolean);
+  const evidenceName = `r1-core-loop-${startedAt.replace(/[:.]/g, "").slice(0, 15)}`;
+  const evidenceDir = path.join(ROOT, "docs", "验收证据", evidenceName);
+  ensureDir(evidenceDir);
+
+  const summary = {
+    status: "running",
+    started_at: startedAt,
+    baseline_commit: "0179c8dfc5aa021865a7b2020df7bfa161f03ec4",
+    llm: { source: llm.source, model: llm.model, host: llm.host, key_len: llm.key_len },
+    budget: {
+      organize_success: 0,
+      source_chat: 0,
+      failure: 0,
+      caps: { organize_success: 3, source_chat: 2, failure: 1 },
+    },
+    deadline_ms: RUN_DEADLINE_MS,
+    checks: {},
+    no_model: { reused: NO_MODEL_EVIDENCE, rerun: false },
+    port: null,
+  };
+  const refusalRecheck = process.env.R1_REFUSAL_RECHECK === "1";
+  if (refusalRecheck) {
+    summary.mode = "refusal-recheck";
+    summary.budget.caps = { organize_success: 1, source_chat: 2, failure: 0 };
+  }
+
+  if (!llm.configured) {
+    summary.status = "failed";
+    summary.error = "环境未配置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL";
+    writeJson(path.join(evidenceDir, "summary.json"), summary);
+    throw new Error(summary.error);
+  }
+
+  const power = readStandbyTimeouts();
+  summary.power = { available: power.available, ac_sec: power.ac_sec, dc_sec: power.dc_sec };
+  printPowerReminder(power);
+
+  const beforeData = snapshotDataDirs();
+  writeJson(path.join(evidenceDir, "data-dirs-before.json"), beforeData);
+
+  rmrf(DATA_ROOT);
+  ensureDir(path.join(DATA_ROOT, "db"));
+  ensureDir(path.join(DATA_ROOT, "uploads"));
+  ensureDir(path.join(DATA_ROOT, "notes"));
+
+  const port = await findFreePort(3011);
+  summary.port = port;
+  const baseUrl = `http://127.0.0.1:${port}`;
+  const childEnv = {
+    ...process.env,
+    PORT: String(port),
+    APP_PASSWORD: password,
+    SESSION_SECRET: sessionSecret,
+    DATABASE_PATH: path.join(DATA_ROOT, "db", "app.db"),
+    UPLOAD_DIR: path.join(DATA_ROOT, "uploads"),
+    NOTES_EXPORT_DIR: path.join(DATA_ROOT, "notes"),
+    NEXT_DIST_DIR: DIST_DIR,
+    LLM_BASE_URL: llmCfg.baseUrl,
+    LLM_API_KEY: llmCfg.apiKey,
+    LLM_MODEL: llmCfg.model,
+    EMBEDDING_API_KEY: "",
+    EMBEDDING_BASE_URL: "",
+    EMBEDDING_MODEL: "",
+  };
+  childEnv.DEMO_MODE = "";
+  delete childEnv.DEMO_RUNTIME;
+
+  const logFile = path.join(DATA_ROOT, "verify.server.log");
+  const child = spawnApp(childEnv, logFile);
+  const jar = {};
+  let keepAwake = null;
+  const cleanup = async () => {
+    killTree(child);
+    await sleep(800);
+    if (fs.existsSync(logFile)) {
+      const raw = fs.readFileSync(logFile, "utf8");
+      fs.writeFileSync(path.join(evidenceDir, "server.log"), sanitizeLog(raw, secrets), "utf8");
+    }
+    rmrf(DATA_ROOT);
+    rmrf(path.join(ROOT, DIST_DIR));
+    const afterData = snapshotDataDirs();
+    writeJson(path.join(evidenceDir, "data-dirs-after.json"), afterData);
+    summary.data_dirs_changed = compareSnapshots(beforeData, afterData);
+  };
+
+  try {
+    keepAwake = await startKeepAwake();
+    summary.keep_awake = Boolean(keepAwake);
+    runGuard = createRunGuard(summary);
+    await waitHealth(baseUrl, HEALTH_TIMEOUT_MS, child);
+    summary.checks.healthz = { ok: true };
+    disableExtraJobs();
+
+    const login = await jsonRequest(baseUrl, jar, "POST", "/api/auth/login", { password });
+    assert(login.status === 200 && login.json?.ok, `登录失败 HTTP ${login.status}`);
+    assert(jar.kb_session, "登录未返回会话 Cookie");
+    summary.checks.login = { ok: true };
+
+    const topic = await jsonRequest(baseUrl, jar, "POST", "/api/topics", { name: FIXTURES.topic });
+    assert(topic.status === 201 && topic.json?.id, `创建主题失败 HTTP ${topic.status}`);
+    const topicId = topic.json.id;
+    summary.checks.topic_create = { ok: true, id: topicId, name: FIXTURES.topic };
+
+    const noteIds = {};
+    const noteKeys = refusalRecheck ? ["A"] : ["A", "B", "C"];
+    for (const key of noteKeys) {
+      const created = await jsonRequest(baseUrl, jar, "POST", "/api/notes", { content: FIXTURES.notes[key] });
+      assert(created.status === 201 && created.json?.id, `记录 ${key} 失败 HTTP ${created.status}`);
+      noteIds[key] = created.json.id;
+      const got = await jsonRequest(baseUrl, jar, "GET", `/api/notes/${noteIds[key]}`);
+      assert(got.status === 200, `读取 ${key} 失败`);
+      assert(got.json?.note?.content === FIXTURES.notes[key], `记录 ${key} 正文不一致`);
+    }
+    summary.checks.record = { ok: true, ids: noteIds };
+
+    const organized = await pollOrganize(baseUrl, jar, noteIds, refusalRecheck ? 180000 : ORGANIZE_TIMEOUT_MS);
+    let recoveredKey = null;
+    if (!refusalRecheck) {
+      recoveredKey = await recoverOneTransientOrganize(baseUrl, jar, noteIds, organized);
+      if (recoveredKey && organized[recoveredKey]?.priorError) {
+        organized[recoveredKey].priorError = redact(organized[recoveredKey].priorError, secrets);
+      }
+    }
+    summary.checks.organize_recovery = recoveredKey
+      ? { key: recoveredKey, note: organized[recoveredKey] }
+      : { skipped: true };
+    for (const key of noteKeys) {
+      if (organized[key]?.aiStatus === "done") spendBudget(summary, "organize_success");
+    }
+    const organizeOk = noteKeys.every((key) => organized[key].aiStatus === "done" && organized[key].contentUnchanged);
+    summary.checks.organize = { ok: organizeOk, notes: organized, required: !refusalRecheck };
+    if (!refusalRecheck) assert(organizeOk, "整理未在时限内全部成功，或正文被覆盖");
+
+    if (refusalRecheck) {
+      summary.checks.topics = { skipped: true };
+      summary.checks.search = { skipped: true };
+    } else {
+    const topics = await jsonRequest(baseUrl, jar, "GET", "/api/topics");
+    const topicRows = topics.json?.topics ?? [];
+    const inbox = topicRows.find((row) => row.id === INBOX_TOPIC_ID);
+    const classified = ["A", "B", "C"].filter((key) => organized[key].topicId && organized[key].topicId !== INBOX_TOPIC_ID);
+    summary.checks.topics = {
+      ok: classified.length >= 1,
+      inboxCount: inbox?.noteCount ?? null,
+      classified,
+      leftInbox: ["A", "B", "C"].filter((key) => organized[key].topicId === INBOX_TOPIC_ID),
+    };
+    assert(summary.checks.topics.ok, "没有任何笔记离开未分类");
+    assert((inbox?.noteCount ?? 0) < 8, "未分类达到主题建议阈值，本轮禁止额外调用");
+
+    const searchHits = {};
+    for (const key of ["A", "B", "C"]) {
+      const q = FIXTURES.searchTerms[key];
+      const res = await jsonRequest(baseUrl, jar, "GET", `/api/search?q=${encodeURIComponent(q)}`);
+      const ids = collectSearchIds(res);
+      searchHits[key] = { q, ids, hit: ids.includes(noteIds[key]) };
+    }
+    summary.checks.search = { ok: Object.values(searchHits).every((row) => row.hit), hits: searchHits };
+    assert(summary.checks.search.ok, "关键词搜索未命中对应笔记");
+    }
+
+    spendBudget(summary, "source_chat");
+    const cite = await chatSse(baseUrl, jar, {
+      scopeType: "sources",
+      sources: [{ type: "note", id: noteIds.A }],
+      message: FIXTURES.citeQuestion,
+    });
+    const citeHasRef = cite.text.includes(`[^${noteIds.A}]`) || cite.text.includes(`[^noteId:${noteIds.A}]`);
+    const citeHasFact = /周二|星期二|週二/.test(cite.text);
+    const citeGrounded = Array.isArray(cite.grounding?.noteIds) && cite.grounding.noteIds.includes(noteIds.A);
+    const citeRefused = cite.text.includes("来源笔记中没有相关内容");
+    summary.checks.cite = {
+      ok: Boolean(citeHasRef && citeHasFact && citeGrounded && !citeRefused && !cite.error),
+      grounding: cite.grounding,
+      hasRef: citeHasRef,
+      hasFact: citeHasFact,
+      refused: citeRefused,
+      conversationId: cite.conversationId,
+      text: cite.text.slice(0, 1200),
+      error: cite.error,
+    };
+    assert(summary.checks.cite.ok, "来源引用未通过：需要可打开引用、命中事实且 grounding 含笔记 A");
+
+    spendBudget(summary, "source_chat");
+    const refuse = await chatSse(baseUrl, jar, {
+      conversationId: cite.conversationId || undefined,
+      scopeType: "sources",
+      sources: [{ type: "note", id: noteIds.A }],
+      message: FIXTURES.refuseQuestion,
+    });
+    const refuseOk = refuse.text.includes("来源笔记中没有相关内容") && !refuse.error;
+    summary.checks.refuse = {
+      ok: refuseOk,
+      grounding: refuse.grounding,
+      conversationId: refuse.conversationId,
+      text: refuse.text.slice(0, 1200),
+      error: refuse.error,
+    };
+    if (!refusalRecheck) {
+    const failStarted = Date.now();
+    const patchKey = await jsonRequest(baseUrl, jar, "PATCH", "/api/settings/llm", { apiKey: INVALID_KEY });
+    assert(patchKey.status === 200 && patchKey.json?.ok, `写入无效 Key 失败 HTTP ${patchKey.status}`);
+    spendBudget(summary, "failure");
+    const reprocess = await jsonRequest(baseUrl, jar, "POST", `/api/notes/${noteIds.C}/reprocess`);
+    assert(reprocess.status === 200, `reprocess 失败 HTTP ${reprocess.status}`);
+    const failed = await pollNote(baseUrl, jar, noteIds.C, FAILURE_TIMEOUT_MS, ["failed"]);
+    const failElapsed = Date.now() - failStarted;
+    const failNote = failed.note;
+    const searchAfter = await jsonRequest(baseUrl, jar, "GET", `/api/search?q=${encodeURIComponent(FIXTURES.searchTerms.C)}`);
+    const zipPath = path.join(evidenceDir, "export.zip");
+    const zip = await downloadZip(baseUrl, jar, zipPath);
+    summary.checks.failure = {
+      ok: Boolean(
+        failNote?.aiStatus === "failed"
+        && failNote?.content === FIXTURES.notes.C
+        && failElapsed < 10 * 60 * 1000
+        && collectSearchIds(searchAfter).includes(noteIds.C)
+        && zip.bytes > 0
+      ),
+      aiStatus: failNote?.aiStatus ?? null,
+      contentUnchanged: failNote?.content === FIXTURES.notes.C,
+      elapsedMs: failElapsed,
+      timedOut: failed.timedOut,
+      searchHit: collectSearchIds(searchAfter).includes(noteIds.C),
+      zip,
+    };
+    assert(summary.checks.failure.ok, "失败降级未在短时间内完成，或搜索/导出不可用");
+    }
+    assert(summary.checks.refuse.ok, "来源拒答未出现固定句");
+    if (refusalRecheck && summary.budget.organize_success === 0 && noteIds.A) {
+      const late = await jsonRequest(baseUrl, jar, "GET", `/api/notes/${noteIds.A}`);
+      const lateNote = late.json?.note;
+      if (lateNote?.aiStatus === "done" && lateNote.content === FIXTURES.notes.A) {
+        organized.A = { ...(organized.A || {}), aiStatus: "done", contentUnchanged: true };
+        summary.checks.organize = { ...summary.checks.organize, ok: true, notes: organized };
+        spendBudget(summary, "organize_success");
+      }
+    }
+    if (refusalRecheck) {
+      assert(summary.budget.source_chat === 2 && summary.budget.failure === 0 && summary.budget.organize_success <= 1, "拒答复验超出剩余预算");
+    } else {
+    assert(
+      summary.budget.organize_success === summary.budget.caps.organize_success
+      && summary.budget.source_chat === summary.budget.caps.source_chat
+      && summary.budget.failure === summary.budget.caps.failure,
+      "调用计数与批准预算不一致",
+    );
+    }
+    runGuard?.assertRunning();
+
+    summary.status = "passed";
+    summary.finished_at = new Date().toISOString();
+    writeJson(path.join(evidenceDir, "summary.json"), summary);
+    writeJson(path.join(evidenceDir, "notes.json"), { ids: noteIds, organized, fixtures: FIXTURES });
+    console.log(`R1 核心闭环通过，证据目录 docs/验收证据/${evidenceName}`);
+    return { evidenceDir, summary };
+  } catch (error) {
+    runGuard?.sample();
+    summary.status = "failed";
+    summary.error = redact(error instanceof Error ? error.message : String(error), secrets);
+    summary.finished_at = new Date().toISOString();
+    if (child.exitCode != null) {
+      summary.server_exit = { code: child.exitCode, signal: child.signalCode };
+    }
+    writeJson(path.join(evidenceDir, "summary.json"), summary);
+    throw error;
+  } finally {
+    runGuard?.stop();
+    runGuard = null;
+    stopKeepAwake(keepAwake);
+    await cleanup();
+    writeJson(path.join(evidenceDir, "summary.json"), summary);
+  }
+}
+
+function isDirectRun() {
+  const entry = process.argv[1];
+  if (!entry) return false;
+  return pathToFileURL(path.resolve(entry)).href === import.meta.url;
+}
+
+if (isDirectRun()) {
+  main().catch((error) => {
+    const message = error instanceof Error ? error.message : String(error);
+    console.error(message.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[REDACTED]").replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]"));
+    process.exitCode = 1;
+  });
+}
diff --git a/tests/config/r1-core-loop-script.test.ts b/tests/config/r1-core-loop-script.test.ts
new file mode 100644
index 0000000..84c9d46
--- /dev/null
+++ b/tests/config/r1-core-loop-script.test.ts
@@ -0,0 +1,63 @@
+import fs from "node:fs";
+import path from "node:path";
+import { describe, expect, it } from "vitest";
+import { FIXTURES, RUN_DEADLINE_MS, SLEEP_GAP_MS, isTransientOrganizeError, parseStandbyIndexes, sleepDetected, sleepGapMs } from "../../scripts/verify-r1-core-loop.mjs";
+
+const repository = path.resolve(import.meta.dirname, "../..");
+const script = fs.readFileSync(path.join(repository, "scripts/verify-r1-core-loop.mjs"), "utf8");
+
+describe("R1 核心闭环编排夹具", () => {
+  it("合成笔记互不包含对方的搜索词和拒答主题", () => {
+    expect(FIXTURES.notes.A).toContain("羽毛球");
+    expect(FIXTURES.notes.B).toContain("Markdown 表格");
+    expect(FIXTURES.notes.C).toContain("叶绿素");
+    expect(FIXTURES.notes.A).not.toContain("茶树");
+    expect(FIXTURES.notes.B).not.toContain("羽毛球");
+    expect(FIXTURES.notes.C).not.toContain("Markdown");
+    expect(FIXTURES.citeQuestion).toContain("羽毛球");
+    expect(FIXTURES.refuseQuestion).toContain("茶树");
+  });
+
+  it("只使用隔离数据目录，并复用无模型证据", () => {
+    expect(script).toContain("data-r1-core");
+    expect(script).toContain('DATABASE_PATH: path.join(DATA_ROOT, "db", "app.db")');
+    expect(script).not.toMatch(/DATABASE_PATH:\s*["']\.\/data\/db\/app\.db["']/);
+    expect(script).toContain("docs/R1安装验收-2026-09-15.md");
+    expect(script).toContain("来源笔记中没有相关内容");
+    expect(script).toContain('EMBEDDING_API_KEY: ""');
+  });
+
+  it("用墙钟和单调时钟的差值识别睡眠，并设整体截止", () => {
+    expect(sleepGapMs(10_000, 9_000)).toBe(1_000);
+    expect(sleepDetected(10_000, 9_000, SLEEP_GAP_MS)).toBe(false);
+    expect(sleepDetected(20_000, 1_000)).toBe(true);
+    expect(RUN_DEADLINE_MS).toBe(180_000 + 480_000 + 480_000 + 120_000 * 2 + 45_000 + 120_000);
+    expect(script).toContain("SetThreadExecutionState");
+    expect(script).toContain("STANDBYIDLE");
+    expect(script).toContain("sleep_detected");
+  });
+
+  it("能从中英文电源查询里读出待机秒数", () => {
+    const zh = [
+      "GUID 别名: STANDBYIDLE",
+      "当前交流电源设置索引: 0x00000000",
+      "当前直流电源设置索引: 0x00000258",
+    ].join("\n");
+    expect(parseStandbyIndexes(zh)).toEqual({ ac_sec: 0, dc_sec: 600 });
+    const en = [
+      "GUID Alias: STANDBYIDLE",
+      "Current AC Power Setting Index: 0x00000708",
+      "Current DC Power Setting Index: 0x00000000",
+    ].join("\n");
+    expect(parseStandbyIndexes(en)).toEqual({ ac_sec: 1800, dc_sec: 0 });
+  });
+
+  it("只把瞬时 429、5xx 或超时视为可补整理", () => {
+    expect(isTransientOrganizeError("LLM 请求失败 HTTP 429: 当前分组上游负载已饱和")).toBe(true);
+    expect(isTransientOrganizeError("LLM 请求失败 HTTP 500: Internal error")).toBe(true);
+    expect(isTransientOrganizeError("The operation was aborted due to timeout")).toBe(true);
+    expect(isTransientOrganizeError("无效的 API Key")).toBe(false);
+    expect(isTransientOrganizeError("")).toBe(false);
+    expect(script).toContain("只补整理一次");
+  });
+});
diff --git a/src/lib/ai/source-refusal.ts b/src/lib/ai/source-refusal.ts
new file mode 100644
index 0000000..093b3e9
--- /dev/null
+++ b/src/lib/ai/source-refusal.ts
@@ -0,0 +1,17 @@
+// 来源问答的固定拒答句。提示词要求模型原样说出，但模型常把主题嵌进去。
+// 最终回答在这里收口；已经引用来源的回答不改，避免把答对的事实改成拒答。
+
+export const SOURCE_REFUSAL_SENTENCE = "来源笔记中没有相关内容";
+
+const INSERTED_TOPIC = /来源笔记中没有[\s\S]{0,120}?相关内容/;
+const REFUSAL_HINT = /来源(笔记|集)?(里|中)没有|没有相关内容|未找到相关|没有找到相关|不在来源/;
+const SOURCE_CITE = /\[\^[^\]]+\]/;
+
+export function enforceSourceRefusal(text: string): string {
+  if (!text || text.includes(SOURCE_REFUSAL_SENTENCE)) return text;
+  if (INSERTED_TOPIC.test(text)) return text.replace(INSERTED_TOPIC, SOURCE_REFUSAL_SENTENCE);
+  if (REFUSAL_HINT.test(text) && !SOURCE_CITE.test(text)) {
+    return `${SOURCE_REFUSAL_SENTENCE}。${text.trimStart()}`;
+  }
+  return text;
+}
diff --git a/tests/lib/source-refusal.test.ts b/tests/lib/source-refusal.test.ts
new file mode 100644
index 0000000..89915cd
--- /dev/null
+++ b/tests/lib/source-refusal.test.ts
@@ -0,0 +1,32 @@
+import { describe, expect, it } from "vitest";
+import { enforceSourceRefusal, SOURCE_REFUSAL_SENTENCE } from "@/lib/ai/source-refusal";
+
+describe("来源拒答固定句", () => {
+  it("已经是固定句时不改写", () => {
+    const text = `${SOURCE_REFUSAL_SENTENCE}。缺的是茶树种植环境。`;
+    expect(enforceSourceRefusal(text)).toBe(text);
+  });
+
+  it("把嵌进主题的拒答收成固定句，并保留后续说明", () => {
+    const raw = "来源笔记中没有关于「茶树种植环境」的相关内容。\n\n当前处于来源问答模式，建议新建普通对话。";
+    const out = enforceSourceRefusal(raw);
+    expect(out.startsWith(SOURCE_REFUSAL_SENTENCE)).toBe(true);
+    expect(out).toContain("建议新建普通对话");
+    expect(out).not.toContain("没有关于");
+  });
+
+  it("其它拒答说法补上固定句", () => {
+    const out = enforceSourceRefusal("来源里没有茶树种植的记录。");
+    expect(out.startsWith(`${SOURCE_REFUSAL_SENTENCE}。`)).toBe(true);
+    expect(out).toContain("茶树种植的记录");
+  });
+
+  it("已引用来源的回答保持原样", () => {
+    const raw = "羽毛球练习安排在每周二早上[^note-a]。";
+    expect(enforceSourceRefusal(raw)).toBe(raw);
+  });
+
+  it("空文本保持为空", () => {
+    expect(enforceSourceRefusal("")).toBe("");
+  });
+});

