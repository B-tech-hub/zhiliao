// 一键体验启动器：拉起本地 mock LLM + Next dev，全程无需任何 API Key。
// 数据写入 ./data-demo/（与正式数据 ./data/ 物理隔离），删除该目录即可重置演示。
// 用 process.execPath 直接调用脚本与 next 的 bin，绕开 Windows 下 npm .cmd 垫片的兼容问题。
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const demoEnv = {
  DEMO_MODE: "1",
  APP_PASSWORD: "demo",
  // 仅本机演示用的固定密钥（32 字符），无安全诉求；固定值保证重启后会话不失效
  SESSION_SECRET: "zhiliao-demo-session-secret-0123",
  DATABASE_PATH: "./data-demo/db/app.db",
  UPLOAD_DIR: "./data-demo/uploads",
  LLM_BASE_URL: "http://127.0.0.1:8787/v1",
  LLM_API_KEY: "demo",
  LLM_MODEL: "mock",
};
// shell 里显式导出过的同名变量以用户为准；.env/.env.local 文件优先级低于此处注入的进程环境变量
const env = { ...demoEnv, ...process.env };

const children = [];
let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (!c.killed) c.kill();
  }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// 探测 8787 是否已有可用的 mock LLM（上次未退干净或用户手动起过时直接复用，避免 EADDRINUSE）
async function probeMock() {
  try {
    const res = await fetch("http://127.0.0.1:8787/v1/chat/completions", { method: "POST", body: "{}" });
    return res.ok;
  } catch {
    return false;
  }
}

if (await probeMock()) {
  console.log("[demo] 检测到 8787 端口已有 mock LLM 在运行，直接复用");
} else {
  // 1. 启动 mock LLM（零依赖，端口 8787）
  const mock = spawn(process.execPath, [path.join(root, "scripts", "mock-llm.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  children.push(mock);
  mock.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[demo] mock LLM 进程意外退出（code=${code}），8787 端口可能被其他程序占用`);
      shutdown(code ?? 1);
    }
  });

  // 2. 等待 mock LLM 就绪（最多 10 秒）
  let ready = false;
  for (let i = 0; i < 50 && !ready; i++) {
    ready = await probeMock();
    if (!ready) await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) {
    console.error("[demo] mock LLM 启动超时，请检查 8787 端口占用情况");
    shutdown(1);
  }
}

// 3. 启动 Next dev
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const app = spawn(process.execPath, [nextBin, "dev", "--turbopack"], {
  cwd: root,
  env,
  stdio: "inherit",
});
children.push(app);
app.on("exit", (code) => shutdown(code ?? 0));

console.log("");
console.log("==========================================");
console.log("  知了 · 一键体验模式（无需 API Key）");
console.log("  地址：http://localhost:3000");
console.log("  （若 3000 被占用，以下方 Next 输出的实际端口为准）");
console.log("  密码：demo");
console.log("  数据目录：./data-demo/（删除即可重置）");
console.log("==========================================");
console.log("");
