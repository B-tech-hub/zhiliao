import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { attachVerificationSignals, runProcess } from "./demo-verification-utils.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const REPOSITORY = "ghcr.io/b-tech-hub/zhiliao";
export const PLATFORMS = ["linux/amd64", "linux/arm64"];
const RUN_LABEL = "io.zhiliao.gate4.run";
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const INDEX_TYPES = new Set([
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
]);
const IMAGE_TYPES = new Set([
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
]);
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
function writeJson(directory, name, value) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + "\n");
}

export function assertNativePlatform(platform, system = process.platform, arch = process.arch) {
  assert(PLATFORMS.includes(platform), "只接受 linux/amd64 或 linux/arm64");
  assert.equal(system, "linux", "门禁 4 必须在 Linux 运行");
  assert.equal(arch, platform === "linux/amd64" ? "x64" : "arm64", "runner 不是目标原生架构");
}

export function releaseTags(tag, version) {
  assert(/^\d+\.\d+\.\d+$/.test(version), "基础版本无效");
  const escaped = version.replaceAll(".", "\\.");
  assert(new RegExp(`^v${escaped}(?:-(?:rc|beta|alpha)(?:[1-9][0-9]*|\\.(?:0|[1-9][0-9]*)))?$`).test(tag), "tag 与基础版本不一致");
  const names = tag.includes("-") ? [tag.slice(1)] : [version, version.split(".").slice(0, 2).join("."), "latest"];
  return names.map((name) => `${REPOSITORY}:${name}`);
}

// attestation 不算运行架构，只允许它引用本索引中的运行镜像。
export function validateIndex(index, expected) {
  assert(INDEX_TYPES.has(index.mediaType) && index.schemaVersion === 2, "需要 OCI/Docker 多架构索引");
  assert(Array.isArray(index.manifests), "索引缺少 manifests");
  const runtime = [];
  const attestations = [];
  const seen = new Set();
  for (const item of index.manifests) {
    assert(DIGEST.test(item.digest) && Number.isSafeInteger(item.size) && item.size > 0, "描述符摘要或大小无效");
    assert(IMAGE_TYPES.has(item.mediaType), "不接受嵌套索引或未知 manifest 类型");
    const platform = `${item.platform?.os}/${item.platform?.architecture}`;
    if (platform === "unknown/unknown" && item.annotations?.["vnd.docker.reference.type"] === "attestation-manifest") {
      attestations.push(item);
      continue;
    }
    assert(PLATFORMS.includes(platform) && !seen.has(platform), "运行架构缺失、重复或出现额外架构");
    assert(!item.platform.variant || (platform === "linux/arm64" && item.platform.variant === "v8"), "运行架构 variant 不匹配");
    seen.add(platform);
    runtime.push({ platform, digest: item.digest, size: item.size });
  }
  assert.deepEqual([...seen].sort(), expected.map((entry) => entry.platform).sort(), "运行架构集合不完整");
  for (const entry of expected) {
    assert.equal(runtime.find((item) => item.platform === entry.platform)?.digest, entry.digest, "运行子 digest 与构建记录不同");
  }
  for (const item of attestations) {
    assert(runtime.some((entry) => entry.digest === item.annotations["vnd.docker.reference.digest"]), "attestation 引用了未知运行镜像");
  }
  return { runtime, attestations };
}

export function validateImageConfig(config, platform, revision) {
  assert(REVISION.test(revision), "必须指定完整 Git 提交");
  assert.equal(`${config.os}/${config.architecture}`, platform, "镜像配置架构不匹配");
  assert.equal(config.config?.Labels?.["org.opencontainers.image.revision"], revision, "OCI revision 与候选提交不同");
}

export function baseMaterials(metadata) {
  const materials = metadata["buildx.build.provenance"]?.materials;
  assert(Array.isArray(materials), "构建元数据缺少实际 provenance materials");
  const base = materials.filter((item) => /^pkg:docker\/node@/.test(item.uri ?? ""));
  assert(base.length > 0 && base.every((item) => /^[a-f0-9]{64}$/.test(item.digest?.sha256 ?? "")), "缺少实际 Node 基础镜像 digest");
  return base.map(({ uri, digest }) => ({ uri, digest }));
}

// 使用匿名 pull token；不读取 Docker 登录配置，也不记录 token。
export function registryClient() {
  let token;
  async function get(kind, reference) {
    assert(DIGEST.test(reference) || (kind === "manifests" && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z]+\.?[0-9]+)?$/.test(reference)), "registry 引用必须固定");
    if (!token) {
      const response = await fetch("https://ghcr.io/token?service=ghcr.io&scope=repository:b-tech-hub/zhiliao:pull", { signal: AbortSignal.timeout(30_000) });
      assert(response.ok, `匿名 registry token 请求失败：${response.status}`);
      token = (await response.json()).token;
      assert(typeof token === "string" && token.length > 0, "匿名 token 响应无效");
    }
    const response = await fetch(`https://ghcr.io/v2/b-tech-hub/zhiliao/${kind}/${reference}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: [...INDEX_TYPES, ...IMAGE_TYPES].join(", ") },
      signal: AbortSignal.timeout(30_000),
    });
    assert(response.ok, `匿名 registry ${kind} 请求失败：${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert(bytes.length <= 8 * 1024 * 1024, "registry 元数据超过预算");
    const digest = `sha256:${sha256(bytes)}`;
    if (DIGEST.test(reference)) assert.equal(digest, reference, "registry 原始字节与 digest 不一致");
    const declared = response.headers.get("docker-content-digest");
    if (declared) assert.equal(digest, declared, "registry 响应摘要不一致");
    return { bytes, digest, json: JSON.parse(bytes.toString("utf8")) };
  }
  return { manifest: (reference) => get("manifests", reference), blob: (reference) => get("blobs", reference) };
}

async function command(directory, program, args, options = {}) {
  const started = Date.now();
  const entry = { command: program, args, started_at: new Date(started).toISOString() };
  try {
    const stdout = await runProcess(program, args, options);
    Object.assign(entry, { status: "passed", stdout });
    return stdout;
  } catch (error) {
    Object.assign(entry, { status: "failed", error: error.message });
    throw error;
  } finally {
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(path.join(directory, "commands.jsonl"), JSON.stringify({ ...entry, duration_ms: Date.now() - started }) + "\n");
  }
}

async function identity(directory, platform, fresh) {
  assertNativePlatform(platform);
  assert.equal(process.env.GITHUB_ACTIONS, "true", "运行入口只供已确认的 GitHub Actions 任务使用");
  const revision = await command(directory, "git", ["rev-parse", "HEAD"]);
  assert(REVISION.test(revision) && revision === process.env.GITHUB_SHA, "checkout 与事件提交不同");
  assert.equal(await command(directory, "git", ["status", "--porcelain", "--untracked-files=no"]), "", "已跟踪输入存在改动");
  if (fresh) {
    for (const name of ["node_modules", ".next", "next-env.d.ts", ".env", "data", "data-demo"]) {
      assert(!fs.existsSync(path.join(ROOT, name)), `不是干净 checkout：${name}`);
    }
  }
  const names = (await command(directory, "git", ["ls-files", "-z"])).split("\0").filter(Boolean);
  const files = names.map((name) => ({ path: name, sha256: sha256(fs.readFileSync(path.join(ROOT, name))) }));
  const result = {
    revision, tree: await command(directory, "git", ["rev-parse", "HEAD^{tree}"]),
    captured_at: new Date().toISOString(), generated_inputs_excluded: ["next-env.d.ts"],
    platform, node: process.version, kernel: os.release(), cpus: os.cpus().length, memory_bytes: os.totalmem(),
    source_files: files, source_sha256: sha256(JSON.stringify(files)),
    run_id: process.env.GITHUB_RUN_ID, run_attempt: process.env.GITHUB_RUN_ATTEMPT,
  };
  writeJson(directory, "identity.json", result);
  await command(directory, "docker", ["version", "--format", "{{json .}}"]);
  return result;
}

async function preflight(directory, platform) {
  await identity(directory, platform, true);
  await command(directory, "docker", ["buildx", "inspect"]);
  await command(directory, "docker", ["buildx", "du"]);
  writeJson(directory, "cache-policy.json", {
    fresh_checkout: true, import_build_cache: false, no_cache: true, pull: true,
    npm_cache: "Dockerfile 的 npm ci 位于全新 builder 层；无 cache mount",
    boundary: "不宣称基础镜像层、registry 或 CDN 从未缓存",
  });
}

async function recordBuild(directory, platform, digest) {
  assertNativePlatform(platform);
  assert(DIGEST.test(digest), "构建 digest 无效");
  const original = readJson(path.join(directory, "identity.json"));
  assert.equal(original.revision, process.env.GITHUB_SHA, "构建前后提交不同");
  for (const file of original.source_files) {
    assert.equal(sha256(fs.readFileSync(path.join(ROOT, file.path))), file.sha256, `构建改写了输入：${file.path}`);
  }
  const metadata = JSON.parse(process.env.BUILD_METADATA ?? "null");
  assert(metadata && metadata["containerimage.digest"] === digest, "构建元数据与输出 digest 不同");
  const materials = baseMaterials(metadata);
  const registry = registryClient();
  const index = await registry.manifest(digest);
  const descriptors = index.json.manifests?.filter((item) => `${item.platform?.os}/${item.platform?.architecture}` === platform);
  assert.equal(descriptors?.length, 1, "平台构建必须包含一个目标运行镜像");
  const checked = validateIndex(index.json, [{ platform, digest: descriptors[0].digest }]);
  const manifest = await registry.manifest(checked.runtime[0].digest);
  assert.equal(manifest.bytes.length, checked.runtime[0].size, "平台 manifest 大小不匹配");
  const config = await registry.blob(manifest.json.config.digest);
  validateImageConfig(config.json, platform, original.revision);
  const result = {
    status: "passed", platform, revision: original.revision, index_digest: digest,
    runtime: checked.runtime[0], config_digest: config.digest, base_materials: materials,
    source_sha256: original.source_sha256,
    recorded_at: new Date().toISOString(),
  };
  writeJson(directory, `build-${platform.replace("/", "-")}.json`, result);
  fs.writeFileSync(path.join(directory, "platform-index.json"), index.bytes);
  return result;
}

function findRecords(directory, basename) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? findRecords(full, basename) : (basename.test(entry.name) ? [full] : []);
  });
}

async function merge(directory, recordsDirectory, tag) {
  const records = findRecords(recordsDirectory, /^build-linux-(amd64|arm64)\.json$/).map(readJson);
  assert.deepEqual(records.map((item) => item.platform).sort(), [...PLATFORMS].sort(), "缺少或重复平台构建记录");
  const revision = await command(directory, "git", ["rev-parse", "HEAD"]);
  assert.equal(revision, process.env.GITHUB_SHA, "合并任务提交不同");
  const version = readJson(path.join(ROOT, "package.json")).version;
  const tags = releaseTags(tag, version);
  for (const item of records) {
    assert(item.status === "passed" && item.revision === revision && DIGEST.test(item.index_digest), "构建记录状态或提交不一致");
  }
  const registry = registryClient();
  for (const item of records) {
    const index = await registry.manifest(item.index_digest);
    validateIndex(index.json, [item.runtime]);
  }
  await command(directory, "docker", ["buildx", "imagetools", "create", ...tags.flatMap((name) => ["--tag", name]), ...records.map((item) => `${REPOSITORY}@${item.index_digest}`)], { timeoutMs: 120_000 });
  const index = await registry.manifest(tag.slice(1));
  const checked = validateIndex(index.json, records.map((item) => item.runtime));
  for (const item of records) {
    const manifest = await registry.manifest(item.runtime.digest);
    assert.equal(manifest.bytes.length, item.runtime.size, "合并后的子 manifest 大小不一致");
    const config = await registry.blob(manifest.json.config.digest);
    assert.equal(config.digest, item.config_digest, "合并后的配置 digest 不一致");
    validateImageConfig(config.json, item.platform, revision);
  }
  const result = { status: "passed", tag, version, revision, tags, digest: index.digest, ...checked, builds: records };
  fs.writeFileSync(path.join(directory, "manifest.raw.json"), index.bytes);
  writeJson(directory, "manifest.json", result);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `digest=${index.digest}\n`);
  return result;
}

// 该函数在镜像内通过 stdin 执行，不把登录凭据或 Cookie 输出到宿主日志。
export async function applicationProbe(mode, previous, version, expectedArch) {
  const { createRequire } = await import("node:module");
  const require = createRequire("/app/server.js");
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const path = require("node:path");
  const hash = (bytes) => require("node:crypto").createHash("sha256").update(bytes).digest("hex");
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, expectedArch);
  const db = new (require("better-sqlite3"))(":memory:");
  db.exec("CREATE TABLE gate4 (value TEXT); INSERT INTO gate4 VALUES ('知了')");
  assert.equal(db.prepare("SELECT value FROM gate4").get().value, "知了");
  db.close();
  const { Jieba } = require("@node-rs/jieba");
  const tokens = Jieba.withDict(require("@node-rs/jieba/dict").dict).cut("南京市长江大桥");
  assert(tokens.includes("南京市") && tokens.includes("长江大桥"));
  const sharp = require("sharp");
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#224466" } }).png().toBuffer();
  assert.equal((await sharp(png).metadata()).width, 8);
  let cookie = "";
  async function request(url, options = {}, status = 200) {
    const response = await fetch(`http://127.0.0.1:3000${url}`, {
      ...options, headers: { Cookie: cookie, ...options.headers }, signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, status, `${options.method ?? "GET"} ${url} 状态不符`);
    return response;
  }
  function json(method, body) { return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await request("/api/healthz"); healthy = true; break; } catch { await delay(1000); }
  }
  assert(healthy, "健康检查超时");
  const login = await request("/api/auth/login", json("POST", { password: process.env.APP_PASSWORD }));
  cookie = login.headers.get("set-cookie")?.match(/(?:^|,\s*)(kb_session=[^;]+)/)?.[1];
  assert(cookie, "登录 Cookie 缺失");
  const mcp = await (await request("/api/mcp", json("POST", { jsonrpc: "2.0", id: 1, method: "initialize" }))).json();
  assert.equal(mcp.result?.serverInfo?.version, version, "MCP 应用版本不一致");
  let state = previous;
  if (mode === "create") {
    const form = new FormData();
    form.append("file", new Blob([png], { type: "image/png" }), "gate4.png");
    const uploaded = await (await request("/api/uploads", { method: "POST", body: form }, 201)).json();
    assert(/^\/api\/images\/[a-z0-9-]+\.png$/.test(uploaded.url), "上传返回地址无效");
    const content = `# 门禁四安装验收\n\n南京市长江大桥 GateFourPersistence\n\n![验收图片](${uploaded.url})\n`;
    const note = await (await request("/api/notes", json("POST", { content }), 201)).json();
    assert(typeof note.id === "string" && note.id.length > 0);
    state = { id: note.id, content, image: uploaded.url, image_sha256: hash(png) };
  }
  const note = (await (await request(`/api/notes/${state.id}`)).json()).note;
  assert.equal(note.content, state.content, "正文不一致");
  assert.notEqual(note.aiStatus, "done", "无模型实例意外完成 AI 整理");
  const results = await (await request(`/api/search?q=${encodeURIComponent("南京市长江大桥")}`)).json();
  assert(results.results.some((item) => item.id === state.id), "中文检索未找到笔记");
  const image = Buffer.from(await (await request(state.image)).arrayBuffer());
  assert.equal(hash(image), state.image_sha256, "图片字节不一致");
  assert(fs.existsSync("/data/db/app.db"), "数据库未写入挂载目录");
  assert.equal(process.env.NOTES_EXPORT_DIR, "/data/notes");
  function markdownFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(directory, entry.name);
      return entry.isDirectory() ? markdownFiles(full) : (full.endsWith(".md") ? [full] : []);
    });
  }
  let markdown;
  for (let attempt = 0; attempt < 30; attempt++) {
    markdown = markdownFiles("/data/notes").find((file) => fs.readFileSync(file, "utf8").includes("GateFourPersistence"));
    if (markdown) break;
    await delay(1000);
  }
  assert(markdown, "Markdown 增量导出缺失");
  const markdownBytes = fs.readFileSync(markdown);
  assert(markdownBytes.toString("utf8").includes(state.content.replaceAll("/api/images/", "../assets/").trim()), "Markdown 正文不完整");
  if (mode === "verify") assert.equal(hash(markdownBytes), state.markdown_sha256, "重建后 Markdown 字节不同");
  return { ...state, markdown_sha256: hash(markdownBytes), node: process.version, arch: process.arch, mcp_version: mcp.result.serverInfo.version, native_modules: ["better-sqlite3", "@node-rs/jieba", "sharp"], status: "passed" };
}

export async function cleanupResources(invoke, runId) {
  const resources = [];
  for (const kind of ["container", "volume"]) {
    const ids = (await invoke([kind, "ls", ...(kind === "container" ? ["-a"] : []), "--filter", `label=${RUN_LABEL}=${runId}`, "--format", kind === "container" ? "{{.ID}}" : "{{.Name}}"])).split(/\r?\n/).filter(Boolean);
    for (const id of ids) {
      const format = kind === "container" ? "{{json .Config.Labels}}" : "{{json .Labels}}";
      const labels = JSON.parse(await invoke([kind, "inspect", "--format", format, id]));
      assert.equal(labels?.[RUN_LABEL], runId, "资源归属不匹配，停止清理");
      resources.push({ kind, id });
    }
  }
  const errors = [];
  for (const { kind, id } of resources) {
    try { await invoke([kind, "rm", ...(kind === "container" ? ["--force"] : []), id]); }
    catch (error) { errors.push(error.message); }
  }
  assert.equal(errors.length, 0, `资源清理失败：${errors.join("；")}`);
  for (const kind of ["container", "volume"]) {
    const remaining = await invoke([kind, "ls", ...(kind === "container" ? ["-a"] : []), "--filter", `label=${RUN_LABEL}=${runId}`, "--quiet"]);
    assert.equal(remaining, "", "清理后仍有本轮资源");
  }
  return { status: "passed", removed: resources };
}

export function finishStatus(checksPassed, cleanupPassed, error) {
  return checksPassed && cleanupPassed && !error ? "passed" : "failed";
}

async function install(directory, platform, manifestFile) {
  const context = await identity(directory, platform, true);
  const manifest = readJson(manifestFile);
  assert(manifest.status === "passed" && manifest.revision === context.revision && DIGEST.test(manifest.digest), "分发记录身份不一致");
  const build = manifest.builds.find((item) => item.platform === platform);
  assert(build, "分发记录缺少目标平台");
  const daemon = path.join(process.env.RUNNER_TEMP, "gate4-docker");
  assert.equal(process.env.DOCKER_HOST, `unix://${daemon}/docker.sock`, "拒绝使用共用 Docker daemon");
  const configDir = path.join(process.env.RUNNER_TEMP, "gate4-anonymous");
  assert.equal(process.env.DOCKER_CONFIG, configDir, "必须使用专用匿名 Docker 配置");
  assert.deepEqual(readJson(path.join(configDir, "config.json")), {}, "匿名配置不是空对象");
  const controller = new AbortController();
  const detach = attachVerificationSignals(() => controller.abort());
  const runId = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-${crypto.randomBytes(6).toString("hex")}`;
  const container = `gate4-${runId}`;
  const invoke = (args, options = {}) => command(directory, "docker", args, { signal: controller.signal, ...options });
  let checksPassed = false;
  let cleanup;
  let failure;
  const result = { platform, revision: context.revision, digest: manifest.digest, run_id: runId, checks: [] };
  try {
    const root = await invoke(["info", "--format", "{{.DockerRootDir}}"]);
    assert.equal(root, path.join(daemon, "data"), "Docker 存储不属于本轮");
    const inventory = {};
    for (const kind of ["image", "container", "volume"]) {
      inventory[kind] = await invoke([kind, "ls", ...(kind !== "volume" ? ["-a"] : []), "--quiet"]);
      assert.equal(inventory[kind], "", "安装前 Docker 存储不是空的");
    }
    writeJson(directory, "cache-before-pull.json", { root, inventory, anonymous: true });
    const registry = registryClient();
    const current = await registry.manifest(manifest.tag.slice(1));
    assert.equal(current.digest, manifest.digest, "RC tag 在安装前发生变化");
    const image = `${REPOSITORY}@${manifest.digest}`;
    await invoke(["pull", "--platform", platform, image], { timeoutMs: 300_000 });
    const inspectFormat = '{"Id":{{json .Id}},"Os":{{json .Os}},"Architecture":{{json .Architecture}},"RepoDigests":{{json .RepoDigests}},"Config":{"Labels":{{json .Config.Labels}}}}';
    const inspected = JSON.parse(await invoke(["image", "inspect", "--format", inspectFormat, image]));
    validateImageConfig({ os: inspected.Os, architecture: inspected.Architecture, config: inspected.Config }, platform, context.revision);
    assert.equal(inspected.Id, build.config_digest, "拉取镜像的配置 digest 不符");
    assert(inspected.RepoDigests.includes(image), "拉取镜像未绑定目标索引 digest");
    writeJson(directory, "pulled-image.json", { id: inspected.Id, os: inspected.Os, architecture: inspected.Architecture, repo_digests: inspected.RepoDigests });
    const volumes = ["db", "uploads", "notes"].map((name) => ({ name: `${container}-${name}`, target: `/data/${name}` }));
    for (const volume of volumes) await invoke(["volume", "create", "--label", `${RUN_LABEL}=${runId}`, volume.name]);
    const appEnv = { ...process.env, APP_PASSWORD: crypto.randomBytes(24).toString("hex"), SESSION_SECRET: crypto.randomBytes(32).toString("hex") };
    const launch = () => invoke(["run", "--detach", "--pull", "never", "--name", container, "--label", `${RUN_LABEL}=${runId}`, "--network", "none", "--memory", "2g", "--cpus", "2", "--pids-limit", "256", "--log-opt", "max-size=5m", "--log-opt", "max-file=1", "--env", "APP_PASSWORD", "--env", "SESSION_SECRET", "--env", "DEMO_MODE=0", "--env", "HOSTNAME=127.0.0.1", ...volumes.flatMap((volume) => ["--mount", `type=volume,source=${volume.name},target=${volume.target}`]), image], { env: appEnv });
    const firstId = await launch();
    const probe = async (mode, state) => {
      const input = `(${applicationProbe.toString()})(${JSON.stringify(mode)},${JSON.stringify(state)},${JSON.stringify(manifest.version)},${JSON.stringify(platform === "linux/amd64" ? "x64" : "arm64")}).then(x=>process.stdout.write(JSON.stringify(x))).catch(e=>process.stdout.write(JSON.stringify({status:"failed",error:e.message})));`;
      const report = JSON.parse(await invoke(["exec", "--interactive", container, "node"], { input, timeoutMs: 180_000 }));
      assert.equal(report.status, "passed", report.error ?? "镜像内检查失败");
      return report;
    };
    const initial = await probe("create", null);
    result.checks.push(initial);
    await invoke(["stop", "--time", "20", container], { timeoutMs: 30_000 });
    const labels = JSON.parse(await invoke(["container", "inspect", "--format", "{{json .Config.Labels}}", container]));
    assert.equal(labels[RUN_LABEL], runId, "重建前资源归属变化");
    await invoke(["container", "rm", container]);
    const secondId = await launch();
    assert.notEqual(firstId, secondId, "没有真正重建容器");
    result.checks.push(await probe("verify", initial));
    checksPassed = true;
  } catch (error) {
    failure = error.message;
    // 只保存本轮合成实例的日志，不读取或输出容器 Env。
    try {
      const labels = JSON.parse(await command(directory, "docker", ["container", "inspect", "--format", "{{json .Config.Labels}}", container]));
      if (labels?.[RUN_LABEL] === runId) {
        await command(directory, "docker", ["logs", "--tail", "100", container]);
      }
    } catch { /* 未创建容器时没有日志 */ }
  } finally {
    detach();
    try { cleanup = await cleanupResources((args) => command(directory, "docker", args), runId); }
    catch (error) { cleanup = { status: "failed", error: error.message }; }
    result.status = finishStatus(checksPassed, cleanup.status === "passed", failure);
    Object.assign(result, { error: failure, cleanup });
    writeJson(directory, "summary.json", result);
  }
  assert.equal(result.status, "passed", failure ?? "安装验收或清理失败");
  return result;
}

async function main(args) {
  if (args.length === 0 || args[0] === "--help") {
    console.log("用法：node scripts/verify-release-gate4.mjs <preflight|record-build|merge|install> --output <新证据目录> [--platform linux/amd64|linux/arm64] [--digest sha256:...] [--records <目录>] [--tag vX.Y.Z-rc1] [--manifest <文件>]\n运行入口限已确认的 GitHub Actions；merge 会推送镜像标签，install 会拉取并运行隔离容器。--help 无副作用。");
    return;
  }
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: Object.fromEntries(["output", "platform", "digest", "records", "tag", "manifest"].map((name) => [name, { type: "string" }])) });
  assert.equal(positionals.length, 1, "只接受一个阶段");
  assert(values.output, "必须提供证据目录");
  assert.equal(process.env.GITHUB_ACTIONS, "true", "运行入口只供已确认的 GitHub Actions 任务使用");
  const directory = path.resolve(values.output);
  const temporary = fs.realpathSync(process.env.RUNNER_TEMP);
  assert(directory.startsWith(temporary + path.sep), "证据必须写入 RUNNER_TEMP 子目录");
  fs.mkdirSync(directory, { recursive: true });
  const stage = positionals[0];
  try {
    if (stage === "preflight") await preflight(directory, values.platform);
    else if (stage === "record-build") await recordBuild(directory, values.platform, values.digest);
    else if (stage === "merge") await merge(directory, values.records, values.tag);
    else if (stage === "install") await install(directory, values.platform, values.manifest);
    else throw new Error("未知验收阶段");
  } catch (error) {
    writeJson(directory, "failure.json", { status: "failed", stage, error: error.message });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(`门禁 4 失败：${error.message}`); process.exitCode = 1; });
}
