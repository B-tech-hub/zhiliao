import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// 仅供本批诊断使用；不接入正式 CI 或安装入口。
const base = "15e295ceb69c7e26b109107b837a09036667f772";
const branch = "refs/heads/diagnostics/0.6.1-pwsh-hosted-warm-a";
const samples = ["O1", "O2", "O3", "O4", "L1", "L2", "L3", "L4"];
const conditions = ["A", "B", "B", "A", "A", "D", "D", "A"];
const target = "tests/config/smoke-fresh-install.test.ts";
const coreHashes = {
  "package.json": "c7264a2aa0b60f44d7991982049b8fe946228f9a2b99aea07122741765367629",
  "package-lock.json": "347f5fda89ca590091ba62211c2cd40e845abaa93d4e1d79a3e0c8395424813e",
  "vitest.config.mts": "386c7045e405d0855313ad030d87e72394cea3926ff1c2a80a2285895524c4d3",
  "tests/setup.ts": "29d62c420def381503d81d400c35cb6a7ba67bd208f30c07f8b6c3f4d275c419",
  "scripts/smoke-fresh-install.ps1": "9bb09cfd1da7ee570108bcda51691c4e82134e64f2aac6a3e50934f4ef5ca454",
  ".github/workflows/ci.yml": "7428f5cac57922f89d33332118190d3936d332001d53e2533f9184de723c7f17",
  ".github/workflows/release.yml": "ca617b85b1c4d35c0939a5be96413732b3ad77e760a9dfbf3ef2585d5e987507"
};
const expectedFiles = [
  "tests/api/demo-boundary.test.ts",
  "tests/api/embedding-backfill.test.ts",
  "tests/api/external-capture.test.ts",
  "tests/api/handwriting.test.ts",
  "tests/api/images.test.ts",
  "tests/api/import.test.ts",
  "tests/api/mcp.test.ts",
  "tests/api/related-notes.test.ts",
  "tests/components/api-token-section.test.tsx",
  "tests/components/client-note-pages.test.tsx",
  "tests/components/command-palette.test.tsx",
  "tests/components/markdown-editor-security.test.tsx",
  "tests/components/nav.test.tsx",
  "tests/components/quick-capture.test.tsx",
  "tests/components/settings-page-demo.test.tsx",
  "tests/components/settings-panel-hydration.test.tsx",
  "tests/config/demo-compose-cli.test.ts",
  "tests/config/demo-compose-wrapper.test.ts",
  "tests/config/demo-compose.test.ts",
  "tests/config/demo-http-probes.test.ts",
  "tests/config/demo-launcher.test.ts",
  "tests/config/demo-network.test.ts",
  "tests/config/demo-proxy-timeouts.test.ts",
  "tests/config/demo-runtime.test.ts",
  "tests/config/demo-verification-utils.test.ts",
  "tests/config/r1-core-loop-script.test.ts",
  "tests/config/release-gate4.test.ts",
  "tests/config/release-version.test.ts",
  "tests/config/smoke-fresh-install.test.ts",
  "tests/docs/first-use-guide.test.ts",
  "tests/lib/ai-tools.test.ts",
  "tests/lib/api-token.test.ts",
  "tests/lib/auth.test.ts",
  "tests/lib/backup.test.ts",
  "tests/lib/chat-loop.test.ts",
  "tests/lib/chat-routes.test.ts",
  "tests/lib/chat-state.test.ts",
  "tests/lib/chat-stream.test.ts",
  "tests/lib/client-note.test.ts",
  "tests/lib/correction-learning.test.ts",
  "tests/lib/embedding.test.ts",
  "tests/lib/export.test.ts",
  "tests/lib/feature-flags.test.ts",
  "tests/lib/fetch-url.test.ts",
  "tests/lib/hybrid-search.test.ts",
  "tests/lib/image-gen.test.ts",
  "tests/lib/import.test.ts",
  "tests/lib/llm-config.test.ts",
  "tests/lib/llm.test.ts",
  "tests/lib/markdown-export.test.ts",
  "tests/lib/math.test.ts",
  "tests/lib/mermaid.test.ts",
  "tests/lib/note-chunking.test.ts",
  "tests/lib/note-chunks.test.ts",
  "tests/lib/notes-corpus-acceptance.test.ts",
  "tests/lib/notes.test.ts",
  "tests/lib/process-note.test.ts",
  "tests/lib/read-note.test.ts",
  "tests/lib/search.test.ts",
  "tests/lib/source-refusal.test.ts",
  "tests/lib/sources.test.ts",
  "tests/lib/t0-acceptance.test.ts",
  "tests/lib/t1-chunking-acceptance.test.ts",
  "tests/lib/tiptap-security.test.ts",
  "tests/lib/trash.test.ts",
  "tests/lib/undo.test.ts",
  "tests/lib/vision-images.test.ts",
  "tests/lib/weekly-review.test.ts"
];
const warmWrapper = "param([string]$TargetScript, [string]$ArgumentsFile, [string]$DockerLog)\nfunction Write-DiagnosticStage([string]$Stage) {\n  if ([string]::IsNullOrEmpty($env:ZHILIAO_PREVIEW_TRACE_FILE)) { return }\n  $record = '{\"probe\":\"DEBUG-pwsh-20260930\",\"stage\":\"' + $Stage + '\",\"ticks\":' + [Diagnostics.Stopwatch]::GetTimestamp() + ',\"frequency\":' + [Diagnostics.Stopwatch]::Frequency + ',\"utc\":\"' + [DateTime]::UtcNow.ToString('o') + '\"}'\n  [IO.File]::AppendAllText($env:ZHILIAO_PREVIEW_TRACE_FILE, $record + [Environment]::NewLine)\n}\nWrite-DiagnosticStage 'wrapper-enter'\n$ErrorActionPreference = \"Stop\"\n[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n$global:PreviewDockerLog = $DockerLog\nfunction global:docker {\n  [IO.File]::AppendAllText($global:PreviewDockerLog, \"called\")\n  throw \"Docker is forbidden in preview tests.\"\n}\n$parameters = @{}\nWrite-DiagnosticStage 'arguments-read-before'\n$config = Get-Content -Raw -Encoding UTF8 -LiteralPath $ArgumentsFile | ConvertFrom-Json\nWrite-DiagnosticStage 'arguments-read-after'\nforeach ($property in $config.PSObject.Properties) { $parameters[$property.Name] = $property.Value }\nWrite-DiagnosticStage 'target-call-before'\n& $TargetScript @parameters\nexit $LASTEXITCODE\n";
const protocol = "hosted-warm-v1";
const root = fs.realpathSync(process.cwd());
const command = process.argv[2];
const sample = process.env.ZHILIAO_PREVIEW_SAMPLE;
const group = process.env.ZHILIAO_PREVIEW_GROUP;
const position = samples.indexOf(sample);
const batchDirectory = process.env.ZHILIAO_PREVIEW_BATCH_DIR;
assert.ok(batchDirectory && path.isAbsolute(batchDirectory));
const batchRoot = fs.realpathSync(batchDirectory);
assert.ok(path.relative(root, batchRoot).startsWith(`..${path.sep}`), "证据必须在 checkout 外");
const unitCommand = ["run", "version-start", "finalize"].includes(command);
if (unitCommand) assert.ok(position >= 0 && group === conditions[position], "单元身份无效");
const out = unitCommand ? path.join(batchRoot, sample) : batchRoot;
if (unitCommand) {
  assert.equal(process.env.ZHILIAO_PREVIEW_CONTROL_DIR, out);
  assert.equal(fs.realpathSync(out), out, "记录目录不能是链接");
}
const file = (name) => path.join(out, name);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const write = (name, value) => fs.writeFileSync(file(name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const read = (name) => JSON.parse(fs.readFileSync(file(name), "utf8"));
const lines = (name) => fs.readFileSync(file(name), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const batchRead = (name) => JSON.parse(fs.readFileSync(path.join(batchRoot, name), "utf8"));
const unitRead = (unit, name) => JSON.parse(fs.readFileSync(path.join(batchRoot, unit, name), "utf8"));

function identity() {
  assert.equal(process.platform, "linux");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.GITHUB_REPOSITORY, "B-tech-hub/zhiliao");
  assert.equal(process.env.GITHUB_REF, branch);
  assert.equal(process.env.GITHUB_EVENT_NAME, "push");
  assert.equal(process.env.GITHUB_RUN_ATTEMPT, "1", "禁止 rerun");
  assert.match(process.env.GITHUB_SHA ?? "", /^[0-9a-f]{40}$/);
  assert.match(process.env.GITHUB_RUN_ID ?? "", /^\d+$/);
  assert.equal(process.env.GITHUB_JOB, "hosted-warm");
  assert.equal(process.env.ZHILIAO_PREVIEW_PROTOCOL, protocol);
  assert.equal(process.env.REQUIRE_DOCKER_COMPOSE, "1");
  assert.ok(process.env.RUNNER_NAME);
  return { protocol, run_id: process.env.GITHUB_RUN_ID, run_attempt: 1, commit: process.env.GITHUB_SHA,
    job: process.env.GITHUB_JOB, runner_name: process.env.RUNNER_NAME, hostname: os.hostname(),
    boot_id: fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() };
}

function inputManifest() {
  // 包括安装后的 node_modules；不跟随链接、不读取 Git 内部或仓库外文件。
  // 空目录不计入文件清单，Vite 的临时配置文件在退出后仍存在则停止。
  const result = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (directory === root && entry.name === ".git") continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isSymbolicLink()) result[relative] = { link: fs.readlinkSync(absolute) };
      else if (entry.isDirectory()) visit(absolute);
      else {
        assert.ok(entry.isFile(), `非普通输入：${relative}`);
        result[relative] = { bytes: fs.statSync(absolute).size, sha256: hash(fs.readFileSync(absolute)) };
      }
    }
  }
  visit(root);
  return result;
}

function inputCheck(name) {
  const began = performance.now();
  const expected = batchRead("input-manifest.json");
  const actual = inputManifest();
  const changed = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .filter((key) => JSON.stringify(expected[key]) !== JSON.stringify(actual[key]));
  const result = { changed, files: Object.keys(actual).length, elapsed_ms: performance.now() - began,
    sha256: hash(JSON.stringify(actual)), scope: "checkout files including node_modules; excludes .git; symlinks recorded without traversal" };
  write(name, result);
  assert.equal(changed.length, 0, "输入或非允许输出变化，停止；不清理后重试");
  return result;
}

function init() {
  const who = identity();
  assert.equal(git("rev-parse", "HEAD"), who.commit);
  assert.deepEqual(git("cat-file", "-p", "HEAD").split("\n").filter((l) => l.startsWith("parent ")).map((l) => l.slice(7)), [base]);
  assert.equal(git("status", "--porcelain", "--untracked-files=all"), "");
  write("batch.json", { ...who, parent: base, started_ms: Date.now(), order: samples, conditions });
  write("input-manifest.json", inputManifest());
}

function batchContext() {
  const current = identity();
  const batch = batchRead("batch.json");
  for (const key of Object.keys(current)) assert.deepEqual(current[key], batch[key], `批次身份变化：${key}`);
  assert.ok(Date.now() - batch.started_ms >= 0 && Date.now() - batch.started_ms < 60 * 60 * 1000);
  return batch;
}

function processTable() {
  const table = new Map();
  for (const pid of fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    try {
      const text = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/);
      table.set(Number(pid), { pid: Number(pid), ppid: Number(fields[1]), pgrp: Number(fields[2]), state: fields[0],
        cpu_ticks: Number(fields[11]) + Number(fields[12]), started_ticks: fields[19] });
    } catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error; }
  }
  return table;
}

function noRemaining(record) {
  assert.ok(record && Array.isArray(record.observed) && record.observed.length > 0);
  assert.ok(Number.isInteger(record.vitest_pid) && record.vitest_pid > 1);
  const table = processTable();
  const remaining = [...table.values()].filter((p) => p.pgrp === record.vitest_pid
    || record.observed.some((old) => old.pid === p.pid && old.started_ticks === p.started_ticks));
  assert.equal(remaining.length, 0, "前项 Vitest 或已观察后代尚未退出");
  return remaining;
}

function previous() {
  const batch = batchContext();
  if (position === 0) return null;
  const prior = unitRead(samples[position - 1], "summary.json");
  assert.equal(prior.sample, samples[position - 1]);
  assert.equal(prior.status, "valid", "前项不是有效完成，停止后续单元");
  for (const key of ["protocol", "run_id", "run_attempt", "commit", "job", "runner_name", "hostname", "boot_id"])
    assert.deepEqual(prior[key], batch[key], `前项身份不符：${key}`);
  noRemaining(unitRead(samples[position - 1], "process-exit.json"));
  return prior;
}

function snapshot(directory) {
  const result = {};
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(directory, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        result[`${relative}/`] = "directory";
        visit(absolute);
      } else result[relative] = hash(fs.readFileSync(absolute));
    }
  }
  visit(directory);
  return result;
}

function prepareFixture() {
  const directory = file("prelude-fixture");
  fs.mkdirSync(directory);
  const checkout = path.join(directory, "checkout with spaces");
  for (const folder of ["scripts", "docs"]) fs.mkdirSync(path.join(checkout, folder), { recursive: true });
  fs.mkdirSync(path.join(directory, "outside"));
  fs.mkdirSync(path.join(directory, "temp"));
  fs.copyFileSync(path.join(root, "scripts/smoke-fresh-install.ps1"), path.join(checkout, "scripts/smoke-fresh-install.ps1"));
  fs.writeFileSync(path.join(checkout, "package.json"), JSON.stringify({ version: "1.2.3" }));
  fs.writeFileSync(path.join(directory, "outside/package.json"), JSON.stringify({ version: "98.0.0" }));
  // wrapper 从 D 的原 fixture 字符串生成，前置探针不另造参数处理路径。
  fs.writeFileSync(path.join(directory, "preview.ps1"), warmWrapper);
  fs.writeFileSync(path.join(directory, "arguments.json"), JSON.stringify({ PrintConfig: true, KeepResources: true, Port: 3317, Image: "ghcr.io/b-tech-hub/zhiliao:0.6.0" }));
  return directory;
}

async function prelude(powershell) {
  const directory = prepareFixture();
  const before = snapshot(directory);
  const started = performance.now();
  const utc = new Date().toISOString();
  {
    write("prelude-start.json", { protocol, sample, utc, first_job_attempt: position === 0, prior_valid_diagnostic_starts: position * 13 });
    const result = spawnSync(powershell, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", path.join(directory, "preview.ps1"),
      "-TargetScript", path.join(directory, "checkout with spaces/scripts/smoke-fresh-install.ps1"),
      "-ArgumentsFile", path.join(directory, "arguments.json"), "-DockerLog", path.join(directory, "docker-calls.txt"),
    ], {
      cwd: path.join(directory, "outside"), encoding: "utf8", timeout: 10_000,
      env: { ...process.env, PATH: "", TEMP: path.join(directory, "temp"), TMP: path.join(directory, "temp"), TMPDIR: path.join(directory, "temp"),
        npm_package_version: "99.0.0", APP_VERSION: "97.0.0", POWERSHELL_TELEMETRY_OPTOUT: "1", POWERSHELL_UPDATECHECK: "Off",
        ZHILIAO_PREVIEW_TRACE_FILE: "" },
    });
    write("prelude-process.json", { utc, duration_ms: performance.now() - started, status: result.status,
      signal: result.signal, error_code: result.error?.code ?? null, stdout: result.stdout, stderr: result.stderr });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), { packageVersion: "1.2.3", image: "ghcr.io/b-tech-hub/zhiliao:0.6.0", port: 3317 });
    assert.equal(fs.existsSync(path.join(directory, "docker-calls.txt")), false);
    assert.deepEqual(snapshot(directory), before);
  }
  const workMs = performance.now() - started;
  assert.ok(workMs < 10_000, "前置处理未在原 10 秒窗口内完成");
  await delay(10_000 - workMs);
  write("prelude.json", { sample, group, utc, active_work_ms: workMs, actual_window_ms: performance.now() - started,
    requested_window_ms: 10_000, powershell_starts: 1 });
}

function processSample(vitestPid, observed) {
  const table = processTable();
  function descendant(pid) {
    const seen = new Set();
    while (table.has(pid) && !seen.has(pid)) {
      seen.add(pid);
      if (pid === vitestPid) return true;
      pid = table.get(pid).ppid;
    }
    return false;
  }
  const workers = [];
  for (const entry of table.values()) {
    if (entry.pgrp !== vitestPid && !descendant(entry.pid)) continue;
    observed.set(`${entry.pid}:${entry.started_ticks}`, entry);
    if (entry.pid === vitestPid) continue;
    try {
      const cmdline = fs.readFileSync(`/proc/${entry.pid}/cmdline`, "utf8").replaceAll("\\", "/");
      if (cmdline.includes("/vitest/dist/workers/forks.js")) workers.push(entry);
    } catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error; }
  }
  fs.appendFileSync(file("process-samples.jsonl"), `${JSON.stringify({ utc_ms: Date.now(), workers })}\n`);
  return table;
}

async function measure() {
  let monitorError;
  const observed = new Map();
  // 新会话用于识别本次进程组；始终等待退出，不在后台继续后续单元。
  const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.pwsh-controlled.mts"], {
    cwd: root, stdio: "inherit", detached: true,
    env: { ...process.env, ZHILIAO_PREVIEW_TRACE_DIR: file("traces"),
      TMPDIR: file("test-temp"), TEMP: file("test-temp"), TMP: file("test-temp") },
  });
  const finished = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const sampleProcesses = () => {
    try { if (child.pid) processSample(child.pid, observed); }
    catch (error) { monitorError ??= String(error); child.kill("SIGTERM"); }
  };
  sampleProcesses();
  const timer = setInterval(sampleProcesses, 100);
  const terminate = () => { monitorError ??= "编排器收到停止信号"; child.kill("SIGTERM"); };
  process.once("SIGTERM", terminate);
  process.once("SIGINT", terminate);
  try {
    const result = await finished;
    sampleProcesses();
    const table = processTable();
    const record = { vitest_pid: child.pid, observed: [...observed.values()],
      remaining: [...table.values()].filter((p) => p.pgrp === child.pid || observed.has(`${p.pid}:${p.started_ticks}`)) };
    write("process-exit.json", record);
    if (record.remaining.length || !record.observed.length) monitorError ??= "进程尚未退出或进程身份缺证";
    write("process-result.json", { ...result, monitor_error: monitorError ?? null });
    assert.deepEqual({ ...result, monitor_error: monitorError ?? null }, { code: 0, signal: null, monitor_error: null });
  } finally {
    clearInterval(timer);
    process.removeListener("SIGTERM", terminate);
    process.removeListener("SIGINT", terminate);
  }
}

async function run() {
  write("started.json", { protocol, sample, group, run_id: process.env.GITHUB_RUN_ID, run_attempt: 1, started_ms: Date.now() });
  const prior = previous();
  const batch = batchContext();
  assert.equal(git("rev-parse", "HEAD"), process.env.GITHUB_SHA);
  const parents = git("cat-file", "-p", "HEAD").split("\n").filter((line) => line.startsWith("parent ")).map((line) => line.slice(7));
  assert.deepEqual(parents, [base]);
  assert.equal(git("status", "--porcelain", "--untracked-files=all"), "", "诊断 checkout 有额外修改");
  for (const [name, expected] of Object.entries(coreHashes)) assert.equal(hash(fs.readFileSync(path.join(root, name))), expected, name);
  const testFiles = git("ls-files", "-z").split("\0").filter((name) => /^tests\/.*\.test\.tsx?$/.test(name)).sort();
  assert.deepEqual(testFiles, expectedFiles);
  const powershell = (process.env.PATH ?? "").split(path.delimiter).map((directory) => path.join(directory, "pwsh")).find((name) => fs.existsSync(name));
  assert.ok(powershell, "pwsh 不可用");
  const stable = { image_os: process.env.ImageOS, image_version: process.env.ImageVersion, os_release: fs.readFileSync("/etc/os-release", "utf8"),
    kernel: os.release(), arch: process.arch, cpu_model: os.cpus()[0]?.model, parallelism: os.availableParallelism(), totalmem: os.totalmem(),
    node: process.version, npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
    pwsh_sha256: hash(fs.readFileSync(fs.realpathSync(powershell))), core_hashes: coreHashes };
  const fingerprint = hash(JSON.stringify(stable));
  // 先保存已采集字段，守卫失败也保留本次环境；stable 与指纹算法不变。
  write("environment.json", { stable, fingerprint, commit: process.env.GITHUB_SHA, parent: base,
    batch_started_ms: batch.started_ms, identity: identity(), protocol, historical_image: "20260920.314.1", test_files: testFiles,
    sample, group, run_id: process.env.GITHUB_RUN_ID, run_attempt: 1,
    previous_fingerprint: prior?.fingerprint ?? null });
  assert.ok(stable.image_os && stable.image_version && stable.cpu_model);
  assert.equal(stable.node, "v22.23.2");
  assert.equal(stable.npm, "10.9.8");
  if (prior) assert.equal(fingerprint, prior.fingerprint, "环境漂移，停止配对");
  inputCheck("input-before.json");
  fs.mkdirSync(file("test-temp"));
  assert.equal(fs.existsSync(file("vite-cache")), false, "单元缓存已存在");
  fs.mkdirSync(file("traces"));
  for (const name of ["events.jsonl", "process-samples.jsonl"]) fs.writeFileSync(file(name), "", { flag: "wx" });
  try {
    await prelude(powershell);
    await measure();
  } finally {
    // 后置输入异常单列，不能覆盖测量首因。
    try { inputCheck("input-after.json"); }
    catch (error) { write("input-error.json", { error: String(error) }); process.exitCode = 1; }
  }
}

function traceResults() {
  const names = fs.readdirSync(file("traces")).filter((name) => /^preview-\d+-\d+\.jsonl$/.test(name))
    .sort((a, b) => Number(a.match(/-(\d+)\.jsonl$/)[1]) - Number(b.match(/-(\d+)\.jsonl$/)[1]));
  assert.equal(names.length, 11);
  return names.map((name, index) => {
    assert.equal(Number(name.match(/-(\d+)\.jsonl$/)[1]), index + 1);
    const rows = lines(`traces/${name}`);
    const before = rows.filter((row) => row.stage === "parent-before-spawn");
    const after = rows.filter((row) => row.stage === "parent-after-spawn");
    assert.equal(before.length, 1);
    assert.equal(after.length, 1);
    assert.equal(before[0].sample, sample);
    assert.equal(before[0].timeout_ms, 10_000);
    assert.equal(after[0].error_code, null);
    assert.equal(after[0].signal, null);
    assert.equal(after[0].status, index < 5 ? 0 : 1);
    assert.equal(after[0].stdout_bytes, Buffer.byteLength(after[0].stdout_excerpt));
    assert.equal(after[0].stderr_bytes, Buffer.byteLength(after[0].stderr_excerpt));
    const childRows = rows.filter((row) => row.ticks !== undefined);
    const expected = ["wrapper-enter", "arguments-read-before", "arguments-read-after", "target-call-before", "target-enter", "package-read-before", "package-read-after"];
    if (index < 5) expected.push("print-config-enter", "print-config-exit");
    assert.deepEqual(childRows.map((row) => row.stage), expected);
    for (let i = 0; i < childRows.length; i++) {
      assert.ok(childRows[i].frequency > 0);
      if (i) assert.ok(childRows[i].ticks >= childRows[i - 1].ticks && childRows[i].frequency === childRows[i - 1].frequency);
    }
    return { sequence: index + 1, before: before[0], after: after[0], child: childRows };
  });
}

function overlap(traces, events, observations) {
  const first = traces[0];
  const begin = Date.parse(first.before.utc);
  const end = Date.parse(first.after.utc);
  const slowEnd = Date.parse(first.child.find((entry) => entry.stage === "arguments-read-after").utc);
  const starts = new Map();
  const intervals = [];
  for (const event of events) {
    if (event.event === "module-start") starts.set(event.module, event.utc_ms);
    if (event.event === "module-end" && starts.has(event.module)) intervals.push({ module: event.module, begin: starts.get(event.module), end: event.utc_ms });
  }
  const otherModules = intervals.filter((entry) => entry.module !== target && Math.max(entry.begin, begin) < Math.min(entry.end, end));
  const active = [];
  for (let i = 1; i < observations.length; i++) {
    const a = observations[i - 1];
    const b = observations[i];
    if (a.utc_ms < begin || b.utc_ms > end) continue;
    for (const worker of b.workers) {
      if (worker.pid === first.before.worker_pid) continue;
      const old = a.workers.find((entry) => entry.pid === worker.pid && entry.started_ticks === worker.started_ticks);
      if (old && worker.cpu_ticks > old.cpu_ticks) active.push({ begin: a.utc_ms, end: b.utc_ms, pid: worker.pid, cpu_ticks: worker.cpu_ticks - old.cpu_ticks,
        overlaps_observed_slow_region: a.utc_ms < slowEnd,
        overlaps_other_module: otherModules.some((entry) => Math.max(entry.begin, a.utc_ms) < Math.min(entry.end, b.utc_ms)) });
    }
  }
  return { valid: active.some((entry) => entry.overlaps_observed_slow_region && entry.overlaps_other_module), first_begin_ms: begin, first_end_ms: end,
    slow_region_end_ms: slowEnd,
    other_modules: otherModules, active_worker_intervals: active, observed_peak_workers: Math.max(0, ...observations.map((entry) => entry.workers.length)) };
}

function durations(traces) {
  const result = {};
  for (const entry of traces.slice(0, 2)) {
    const key = entry.before.image === "default" ? "default" : "historical";
    const value = entry.after.duration_ms;
    assert.ok(Number.isFinite(value) && value > 0, "父进程耗时缺失");
    result[key] = value;
  }
  assert.deepEqual(Object.keys(result).sort(), ["default", "historical"]);
  return result;
}

function effect(baseValue, value) {
  const delta = value - baseValue;
  return { baseline_ms: baseValue, value_ms: value, delta_ms: delta,
    ratio: delta / baseValue, meets_threshold: Math.abs(delta) >= 500 && Math.abs(delta) >= baseValue * 0.25 };
}

function blockAnalysis(currentDurations) {
  if (!["O4", "L4"].includes(sample)) return null;
  const value = (unit) => unit === sample ? currentDurations : unitRead(unit, "summary.json").durations_ms;
  const driftPairs = sample === "O4" ? [["O1", "O4"], ["O2", "O3"]] : [["L1", "L4"]];
  const drifts = driftPairs.flatMap(([a, b]) => ["default", "historical"].map((mode) => ({ a, b, mode, ...effect(value(a)[mode], value(b)[mode]) })));
  const pairs = sample === "O4" ? [["O1", "O2"], ["O4", "O3"]] : [["L1", "L2"], ["L4", "L3"]];
  const comparisons = pairs.map(([a, b]) => ({ a, b, default: effect(value(a).default, value(b).default),
    historical: effect(value(a).historical, value(b).historical) }));
  const drifting = drifts.some((row) => row.meets_threshold);
  const loadValid = sample === "O4" || ["L2", "L3"].every((unit) => unitRead(unit, "summary.json").load_valid === true);
  const signal = !drifting && loadValid && comparisons.every((pair) => pair.default.meets_threshold
    && (sample === "O4" ? pair.default.delta_ms < 0 && pair.historical.delta_ms > 0 && pair.historical.meets_threshold : pair.default.delta_ms > 0));
  const report = { block: sample[0], drifts, comparisons, drifting, load_valid: loadValid,
    screening_signal: signal, interpretation: "同一 runner、已有前置启动；不是独立环境重复，不判原超时根因", startup_causal_test_complete: false };
  write("block-analysis.json", report);
  assert.equal(drifting, false, "同机基准出现可观测漂移，停止后续块");
  assert.equal(loadValid, true, "D 负载缺证");
  return report;
}

function versionStart() {
  batchContext();
  const started = read("started.json");
  assert.equal(started.sample, sample);
  assert.equal(started.group, group);
  assert.equal(started.protocol, protocol);
  assert.equal(started.run_id, process.env.GITHUB_RUN_ID);
  assert.equal(started.run_attempt, 1);
  write("version-start.json", { protocol, sample, utc: new Date().toISOString(), attempted: true });
}

function batchSummary() {
  const batch = batchContext();
  const units = samples.map((unit, i) => {
    const directory = path.join(batchRoot, unit);
    const get = (name) => fs.existsSync(path.join(directory, name)) ? unitRead(unit, name) : null;
    const summary = get("summary.json");
    const started = get("started.json");
    let attempts = 0;
    const traces = path.join(directory, "traces");
    if (fs.existsSync(traces)) {
      for (const name of fs.readdirSync(traces).filter((n) => /^preview-\d+-\d+\.jsonl$/.test(n))) {
        attempts += fs.readFileSync(path.join(traces, name), "utf8").split("\n").filter(Boolean)
          .map((line) => JSON.parse(line)).filter((row) => row.stage === "parent-before-spawn").length;
      }
    }
    return { sample: unit, group: conditions[i], status: summary?.status ?? (started ? "incomplete" : "not-started"),
      primary_error: summary?.primary_error ?? get("fatal-run.json") ?? null,
      secondary_errors: summary?.secondary_errors ?? [], formal_attempt_markers: attempts,
      prelude_attempt_marker: get("prelude-start.json") !== null, version_attempt_marker: get("version-start.json") !== null,
      durations_ms: summary?.durations_ms ?? null, prelude: get("prelude-process.json"),
      block_analysis: get("block-analysis.json") };
  });
  const counts = { formal_attempt_markers: units.reduce((n, u) => n + u.formal_attempt_markers, 0),
    prelude_attempt_markers: units.filter((u) => u.prelude_attempt_marker).length,
    version_attempt_markers: units.filter((u) => u.version_attempt_marker).length };
  const complete = units.every((u) => u.status === "valid");
  write("batch-summary.json", { ...batch, units, counts, complete, independent_runner_samples: 1,
    complete_original_matrix_pairs: 0, startup_causal_test_complete: false,
    counting_limit: "标记表示启动尝试；中断可造成进程实际创建状态未知，缺证不补成成功启动", protocol });
  if (!complete) process.exitCode = 1;
}

function finalize() {
  let environment;
  const summary = { protocol, sample, group, status: "stop", run_id: process.env.GITHUB_RUN_ID, run_attempt: 1, commit: process.env.GITHUB_SHA,
    primary_error: null, secondary_errors: [] };
  let evidenceSource = "fatal-run.json";
  try {
    // 优先保留 run 首次异常，其次保留已记录的子进程失败；后续收口错误单列。
    if (fs.existsSync(file("fatal-run.json"))) {
      const fatal = read("fatal-run.json");
      assert.equal(fatal.sample, sample);
      assert.equal(typeof fatal.error, "string");
      assert.ok(fatal.error.length > 0);
      summary.primary_error = { source: evidenceSource, message: fatal.error };
      summary.error = fatal.error;
    } else if (fs.existsSync(file("process-result.json"))) {
      evidenceSource = "process-result.json";
      const result = read("process-result.json");
      if (result.code !== 0 || result.signal !== null || result.monitor_error !== null) {
        const message = `受控测量进程失败：${JSON.stringify(result)}`;
        summary.primary_error = { source: evidenceSource, message };
        summary.error = message;
      }
    }
    if (summary.primary_error === null && fs.existsSync(file("input-error.json"))) {
      const failure = read("input-error.json");
      summary.primary_error = { source: "input-error.json", message: failure.error };
      summary.error = failure.error;
    }
    evidenceSource = "finalize";
    Object.assign(summary, identity());
    const prior = previous();
    environment = read("environment.json");
    Object.assign(summary, { fingerprint: environment.fingerprint, batch_started_ms: environment.batch_started_ms });
    assert.ok(Date.now() - summary.batch_started_ms < 60 * 60 * 1000);
    assert.equal(process.env.ZHILIAO_MEASURE_OUTCOME, "success", "测量步骤失败");
    assert.equal(process.env.ZHILIAO_VERSION_OUTCOME, "success", "测后版本步骤失败");
    assert.equal(read("version-start.json").sample, sample);
    const version = read("powershell-version.json");
    const preparation = read("prelude.json");
    assert.equal(preparation.sample, sample);
    assert.equal(preparation.group, group);
    assert.equal(preparation.powershell_starts, 1);
    assert.equal(preparation.requested_window_ms, 10_000);
    assert.ok(preparation.active_work_ms < 10_000);
    const preludeProcess = read("prelude-process.json");
    assert.equal(preludeProcess.status, 0);
    assert.equal(preludeProcess.error_code, null);
    assert.equal(preludeProcess.signal, null);
    assert.equal(preludeProcess.stderr, "");
    assert.equal(read("prelude-start.json").sample, sample);
    assert.equal(typeof version.version, "string");
    assert.equal(version.edition, "Core");
    summary.powershell = version;
    if (prior) assert.deepEqual(version, prior.powershell);
    const result = read("process-result.json");
    assert.deepEqual(result, { code: 0, signal: null, monitor_error: null });
    assert.equal(read("input-before.json").changed.length, 0);
    assert.equal(read("input-after.json").changed.length, 0);
    assert.equal(fs.existsSync(file("input-error.json")), false, "测后输入不符");
    noRemaining(read("process-exit.json"));
    const report = read("vitest.json");
    assert.equal(report.success, true);
    assert.equal(report.numFailedTests, 0);
    assert.equal(report.numTodoTests, 0);
    assert.equal(report.numTotalTests, group === "D" ? 912 : 11);
    assert.equal(report.numPendingTests, group === "D" ? 28 : 0);
    assert.equal(report.numPassedTests, group === "D" ? 884 : 11);
    const reportPaths = report.testResults.map((entry) => path.relative(root, entry.name).split(path.sep).join("/")).sort();
    assert.deepEqual(reportPaths, group === "D" ? expectedFiles : [target]);
    const previewReport = report.testResults.find((entry) => entry.name.replaceAll("\\", "/").endsWith(`/${target}`));
    assert.equal(previewReport.assertionResults.length, 11);
    assert.ok(previewReport.assertionResults.every((entry) => entry.status === "passed"));
    const traces = traceResults();
    assert.equal(traces[0].before.image, group === "B" ? "ghcr.io/b-tech-hub/zhiliao:0.6.0" : "default");
    assert.equal(traces[1].before.image, group === "B" ? "default" : "ghcr.io/b-tech-hub/zhiliao:0.6.0");
    const events = lines("events.jsonl");
    const completed = events.filter((entry) => entry.event === "run-end");
    assert.equal(completed.length, 1);
    assert.equal(completed[0].unhandled_errors, 0);
    assert.equal(completed[0].reason, "passed");
    assert.equal(events.find((entry) => entry.event === "module-queued")?.module, target, "目标未被首先派发");
    const observations = lines("process-samples.jsonl");
    assert.ok(observations.length > 1 && observations.some((entry) => entry.workers.some((worker) => worker.pid === traces[0].before.worker_pid)), "worker 采样不可用");
    const load = overlap(traces, events, observations);
    write("trace-results.json", traces);
    write("overlap.json", load);
    if (group === "D") assert.equal(load.valid, true, "D 组首项缺少实际负载重叠");
    if (group !== "D") assert.equal(load.observed_peak_workers, 1);
    summary.durations_ms = durations(traces);
    summary.known_diagnostic_starts_after = (position + 1) * 13;
    summary.block_analysis = blockAnalysis(summary.durations_ms);
    // 即使其余记录完整，已有 run 失败也不能转为有效样本。
    if (summary.primary_error === null) summary.status = "valid";
    else process.exitCode = 1;
    summary.counts = { total: report.numTotalTests, passed: report.numPassedTests, skipped: report.numPendingTests };
    summary.observed_peak_workers = load.observed_peak_workers;
    summary.load_valid = group === "D" ? load.valid : null;
  } catch (error) {
    const failure = { source: evidenceSource, message: String(error) };
    if (summary.primary_error === null) {
      summary.primary_error = failure;
      summary.error = failure.message;
    } else summary.secondary_errors.push(failure);
    process.exitCode = 1;
  }
  write("summary.json", summary);
  console.log(JSON.stringify(summary));
}

try {
  identity();
  if (command === "init") init();
  else if (command === "run") await run();
  else if (command === "version-start") versionStart();
  else if (command === "finalize") finalize();
  else if (command === "batch") batchSummary();
  else throw new Error("未知编排命令");
} catch (error) {
  const safeCommand = ["init", "run", "version-start", "finalize", "batch"].includes(command) ? command : "unknown";
  write(`fatal-${safeCommand}.json`, { protocol, sample, error: String(error) });
  console.error(String(error));
  process.exitCode = 1;
}
