import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, cleanDockerEnvironment } from "./demo-verification-utils.mjs";

export const DEMO_COMPOSE_FILE = "docker-compose.demo.yml";
export const DEMO_COMPOSE_PROJECT = "zhiliao-demo";
export const DEMO_ENV_FILE = "demo.env";

export function buildDemoComposeArgs(userArgs = []) {
  const args = [];
  if (!userArgs.includes("--env-file")) args.push("--env-file", DEMO_ENV_FILE);
  if (!userArgs.includes("-p") && !userArgs.includes("--project-name")) args.push("-p", DEMO_COMPOSE_PROJECT);
  if (!userArgs.includes("-f") && !userArgs.includes("--file")) args.push("-f", DEMO_COMPOSE_FILE);
  args.push(...userArgs);
  return args;
}

export function resolveDemoEnvFile(args, cwd = REPO_ROOT) {
  const index = args.indexOf("--env-file");
  if (index === -1 || !args[index + 1]) throw new Error("缺少 --env-file");
  return path.resolve(cwd, args[index + 1]);
}

export function runDemoCompose(userArgs = [], { spawnFn = spawn, env = cleanDockerEnvironment(), cwd = REPO_ROOT } = {}) {
  const args = buildDemoComposeArgs(userArgs);
  const envFile = resolveDemoEnvFile(args, cwd);
  if (!fs.existsSync(envFile)) throw new Error("缺少独立 Demo 环境文件，请先创建 demo.env");
  return new Promise((resolve, reject) => {
    const child = spawnFn("docker", ["compose", ...args], { cwd, env, stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runDemoCompose(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
