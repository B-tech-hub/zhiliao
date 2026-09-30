import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// 仅供本批诊断使用；不接入正式 CI 或安装入口。
const base = "b30a6c94ef30516e864d762b3df4e4e02583e865";
const branch = "refs/heads/diagnostics/0.6.1-pwsh-controlled-b";
const samples = ["A1", "B1", "C1", "D1", "D2", "C2", "B2", "A2"];
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
const root = fs.realpathSync(process.cwd());
const out = process.env.ZHILIAO_PREVIEW_CONTROL_DIR;
const sample = process.env.ZHILIAO_PREVIEW_SAMPLE;
const group = process.env.ZHILIAO_PREVIEW_GROUP;
const position = samples.indexOf(sample);
assert.equal(process.platform, "linux", "受控实验只在 Linux runner 运行");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.GITHUB_REF, branch);
assert.equal(process.env.GITHUB_RUN_ATTEMPT, "1", "禁止 rerun 复用本批现场");
assert.ok(position >= 0 && group === sample[0], "样本身份无效");
assert.ok(out && path.isAbsolute(out));
const relativeOut = path.relative(root, fs.realpathSync(out));
assert.ok(relativeOut.startsWith(`..${path.sep}`), "证据必须在 checkout 外");
const file = (name) => path.join(out, name);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const write = (name, value) => fs.writeFileSync(file(name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const read = (name) => JSON.parse(fs.readFileSync(file(name), "utf8"));
const lines = (name) => fs.readFileSync(file(name), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function previous() {
  if (position === 0) return null;
  const prior = JSON.parse(fs.readFileSync(path.join(process.env.ZHILIAO_PREVIEW_PREVIOUS_DIR, "summary.json"), "utf8"));
  assert.equal(prior.sample, samples[position - 1]);
  assert.equal(prior.status, "valid", "前项不是有效完成，停止后续样本");
  assert.equal(prior.run_id, process.env.GITHUB_RUN_ID);
  assert.equal(prior.run_attempt, 1);
  assert.equal(prior.commit, process.env.GITHUB_SHA);
  assert.ok(Date.now() - prior.batch_started_ms < 60 * 60 * 1000, "整批时间预算耗尽");
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
  if (group === "C") {
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
    requested_window_ms: 10_000, powershell_starts: group === "C" ? 1 : 0 });
}

function processSample(vitestPid) {
  const table = new Map();
  for (const pid of fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    try {
      const text = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/);
      table.set(Number(pid), { pid: Number(pid), ppid: Number(fields[1]), state: fields[0],
        cpu_ticks: Number(fields[11]) + Number(fields[12]), started_ticks: fields[19] });
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
    }
  }
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
    if (entry.pid === vitestPid || !descendant(entry.pid)) continue;
    try {
      const command = fs.readFileSync(`/proc/${entry.pid}/cmdline`, "utf8").replaceAll("\\", "/");
      if (command.includes("/vitest/dist/workers/forks.js")) workers.push(entry);
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
    }
  }
  // 不输出进程命令行或环境，只保留本次 Vitest 后代中的 worker 身份与计数。
  fs.appendFileSync(file("process-samples.jsonl"), `${JSON.stringify({ utc_ms: Date.now(), workers })}\n`);
}

async function run() {
  const prior = previous();
  write("started.json", { sample, group, run_id: process.env.GITHUB_RUN_ID, run_attempt: 1, started_ms: Date.now() });
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
    batch_started_ms: prior?.batch_started_ms ?? Date.now(), historical_image: "20260920.314.1", test_files: testFiles,
    sample, group, run_id: process.env.GITHUB_RUN_ID, run_attempt: 1,
    previous_fingerprint: prior?.fingerprint ?? null });
  assert.ok(stable.image_os && stable.image_version && stable.cpu_model);
  assert.equal(stable.node, "v22.23.2");
  assert.equal(stable.npm, "10.9.8");
  if (prior) assert.equal(fingerprint, prior.fingerprint, "环境漂移，停止配对");
  fs.mkdirSync(file("traces"));
  for (const name of ["events.jsonl", "process-samples.jsonl"]) fs.writeFileSync(file(name), "", { flag: "wx" });
  await prelude(powershell);
  let monitorError;
  const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.pwsh-controlled.mts"], {
    cwd: root, stdio: "inherit", env: { ...process.env, ZHILIAO_PREVIEW_TRACE_DIR: file("traces") },
  });
  const timer = setInterval(() => {
    try { if (child.pid) processSample(child.pid); }
    catch (error) { monitorError = String(error); clearInterval(timer); child.kill("SIGTERM"); }
  }, 100);
  const terminate = () => child.kill("SIGTERM");
  process.once("SIGTERM", terminate);
  process.once("SIGINT", terminate);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    write("process-result.json", { ...result, monitor_error: monitorError ?? null });
    if (result.code !== 0 || result.signal || monitorError) process.exitCode = 1;
  } finally {
    clearInterval(timer);
    process.removeListener("SIGTERM", terminate);
    process.removeListener("SIGINT", terminate);
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

function finalize() {
  let environment;
  const summary = { sample, group, status: "stop", run_id: process.env.GITHUB_RUN_ID, run_attempt: 1, commit: process.env.GITHUB_SHA,
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
    evidenceSource = "finalize";
    const prior = previous();
    environment = read("environment.json");
    Object.assign(summary, { fingerprint: environment.fingerprint, batch_started_ms: environment.batch_started_ms });
    assert.ok(Date.now() - summary.batch_started_ms < 60 * 60 * 1000);
    const version = read("powershell-version.json");
    assert.equal(typeof version.version, "string");
    assert.equal(version.edition, "Core");
    summary.powershell = version;
    if (prior) assert.deepEqual(version, prior.powershell);
    const result = read("process-result.json");
    assert.deepEqual(result, { code: 0, signal: null, monitor_error: null });
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
  if (process.argv[2] === "run") await run();
  else if (process.argv[2] === "finalize") finalize();
  else throw new Error("仅支持 run 或 finalize");
} catch (error) {
  write(`fatal-${process.argv[2] ?? "unknown"}.json`, { sample, error: String(error) });
  console.error(String(error));
  process.exitCode = 1;
}
