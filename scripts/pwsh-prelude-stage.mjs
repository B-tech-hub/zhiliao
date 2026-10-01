import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const warmWrapper = "param([string]$TargetScript, [string]$ArgumentsFile, [string]$DockerLog)\nfunction Write-DiagnosticStage([string]$Stage) {\n  if ([string]::IsNullOrEmpty($env:ZHILIAO_PREVIEW_TRACE_FILE)) { return }\n  $record = '{\"probe\":\"DEBUG-pwsh-20260930\",\"stage\":\"' + $Stage + '\",\"ticks\":' + [Diagnostics.Stopwatch]::GetTimestamp() + ',\"frequency\":' + [Diagnostics.Stopwatch]::Frequency + ',\"utc\":\"' + [DateTime]::UtcNow.ToString('o') + '\"}'\n  [IO.File]::AppendAllText($env:ZHILIAO_PREVIEW_TRACE_FILE, $record + [Environment]::NewLine)\n}\nWrite-DiagnosticStage 'wrapper-enter'\n$ErrorActionPreference = \"Stop\"\n[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n$global:PreviewDockerLog = $DockerLog\nfunction global:docker {\n  [IO.File]::AppendAllText($global:PreviewDockerLog, \"called\")\n  throw \"Docker is forbidden in preview tests.\"\n}\n$parameters = @{}\nWrite-DiagnosticStage 'arguments-read-before'\n$config = Get-Content -Raw -Encoding UTF8 -LiteralPath $ArgumentsFile | ConvertFrom-Json\nWrite-DiagnosticStage 'arguments-read-after'\nforeach ($property in $config.PSObject.Properties) { $parameters[$property.Name] = $property.Value }\nWrite-DiagnosticStage 'target-call-before'\n& $TargetScript @parameters\nexit $LASTEXITCODE\n";
const fixedInputs = {"scripts/smoke-fresh-install.ps1": "9bb09cfd1da7ee570108bcda51691c4e82134e64f2aac6a3e50934f4ef5ca454", "scripts/pwsh-preview-controlled.mjs": "6c6ad6096432111161d3649645a8abf234541775ad83cd2cfc15a2e41fe3e590"};
const stages = ["wrapper-enter", "arguments-read-before", "arguments-read-after", "target-call-before"];
const hash = (data) => createHash("sha256").update(data).digest("hex");

export function parsePreludeTrace(envelope, expected) {
  assert.deepEqual(envelope.identity, expected, "前置记录身份不符");
  const rows = envelope.text.trim() ? envelope.text.trim().split("\n").map((line) => JSON.parse(line)) : [];
  assert.ok(rows.length <= stages.length, "阶段重复或过多");
  let previous;
  for (const [index, row] of rows.entries()) {
    assert.equal(row.probe, "DEBUG-pwsh-20260930", "阶段标识不符");
    assert.equal(row.stage, stages[index], "阶段顺序或名称不符");
    assert.ok(Number.isSafeInteger(row.ticks) && row.ticks >= 0);
    assert.ok(Number.isSafeInteger(row.frequency) && row.frequency > 0);
    assert.equal(typeof row.utc, "string");
    assert.ok(Number.isFinite(Date.parse(row.utc)) && row.utc.endsWith("Z"));
    if (previous) {
      assert.equal(row.frequency, previous.frequency);
      assert.ok(row.ticks >= previous.ticks, "子进程单调时钟倒退");
      assert.ok(Date.parse(row.utc) >= Date.parse(previous.utc), "子进程 UTC 倒退");
    }
    previous = row;
  }
  return { count: rows.length, last_stage: rows.at(-1)?.stage ?? null,
    boundary: rows.length ? `最后观察到 ${rows.at(-1).stage}` : "未观察到 wrapper 首次写入",
    child_elapsed_ms: rows.length ? (rows.at(-1).ticks - rows[0].ticks) * 1000 / rows[0].frequency : null,
    rows, causal_conclusion: "unknown" };
}

// 注入边界仅供离线验证；正式入口仍调用一次原 spawnSync。
export function capturePrelude({ identity, invoke, save, readTrace, clock = () => performance.now() }) {
  const summary = { identity, status: "stop", primary_error: null, secondary_errors: [], trace: null };
  const failure = (source, error) => {
    const item = { source, message: String(error), code: error?.code ?? null };
    if (summary.primary_error === null) summary.primary_error = item;
    else summary.secondary_errors.push(item);
  };
  const persist = (name, value) => { try { save(name, value); } catch (error) { failure(name, error); } };
  const start = clock();
  persist("parent-before.json", { identity, utc: new Date().toISOString(), monotonic_ms: start });
  if (summary.primary_error) return summary;
  let result;
  try { result = invoke(); }
  catch (error) { result = { error, status: null, signal: null, stdout: "", stderr: "" }; }
  const end = clock();
  if (result.error) failure("spawnSync", result.error);
  else if (result.status !== 0 || result.signal !== null) failure("spawnSync", new Error(`前置退出异常：${result.status}/${result.signal}`));
  const raw = { identity, utc: new Date().toISOString(), parent_duration_ms: end - start,
    status: result.status, signal: result.signal, error_code: result.error?.code ?? null,
    error: result.error ? String(result.error) : null, stdout: result.stdout, stderr: result.stderr };
  // 原调用首因先落盘；阶段解析和记录失败只能成为次生错误。
  persist("prelude-process.json", raw);
  persist("parent-return.json", { identity, monotonic_ms: end, parent_duration_ms: end - start });
  try {
    summary.trace = parsePreludeTrace(readTrace(), identity);
    if (!summary.primary_error) assert.equal(summary.trace.count, 4, "正常退出但阶段缺证");
  } catch (error) { failure("trace", error); }
  if (!summary.primary_error) {
    try {
      assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(result.stdout), { packageVersion: "1.2.3", image: "ghcr.io/b-tech-hub/zhiliao:0.6.0", port: 3317 });
    } catch (error) { failure("preview-output", error); }
  }
  summary.parent_duration_ms = raw.parent_duration_ms;
  if (!summary.primary_error) summary.status = "passed";
  persist("summary.json", summary);
  if (summary.primary_error) summary.status = "stop";
  return summary;
}

export function runPreludeProbe(output, powershell, invokeProcess = spawnSync) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assert.ok(path.isAbsolute(output) && path.isAbsolute(powershell));
  const parent = fs.realpathSync(path.dirname(output));
  const relative = path.relative(root, parent);
  assert.ok(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), "证据目录必须在源码副本之外");
  assert.equal(fs.existsSync(output), false, "诊断目录已存在，不重跑");
  for (const [name, expected] of Object.entries(fixedInputs)) assert.equal(hash(fs.readFileSync(path.join(root, name))), expected, name);
  fs.mkdirSync(output);
  const save = (name, value) => fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  const fixture = path.join(output, "prelude-fixture");
  const checkout = path.join(fixture, "checkout with spaces");
  for (const folder of ["scripts", "docs"]) fs.mkdirSync(path.join(checkout, folder), { recursive: true });
  for (const folder of ["outside", "temp"]) fs.mkdirSync(path.join(fixture, folder));
  fs.copyFileSync(path.join(root, "scripts/smoke-fresh-install.ps1"), path.join(checkout, "scripts/smoke-fresh-install.ps1"));
  fs.writeFileSync(path.join(checkout, "package.json"), JSON.stringify({ version: "1.2.3" }));
  fs.writeFileSync(path.join(fixture, "outside/package.json"), JSON.stringify({ version: "98.0.0" }));
  fs.writeFileSync(path.join(fixture, "preview.ps1"), warmWrapper);
  fs.writeFileSync(path.join(fixture, "arguments.json"), JSON.stringify({ PrintConfig: true, KeepResources: true, Port: 3317, Image: "ghcr.io/b-tech-hub/zhiliao:0.6.0" }));
  const snapshot = () => Object.fromEntries(fs.readdirSync(fixture, { recursive: true }).filter((name) => fs.statSync(path.join(fixture, name)).isFile())
    .sort().map((name) => [name, hash(fs.readFileSync(path.join(fixture, name)))]));
  const before = snapshot();
  const identity = { protocol: "prelude-stage-v1", unit: "P1", token: randomUUID(), parent_pid: process.pid,
    source_sha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))), wrapper_sha256: hash(warmWrapper),
    target_sha256: fixedInputs["scripts/smoke-fresh-install.ps1"], pwsh_sha256: hash(fs.readFileSync(fs.realpathSync(powershell))) };
  save("identity.json", identity);
  save("fixture-before.json", before);
  const trace = path.join(output, "prelude-stages.jsonl");
  fs.writeFileSync(trace, "", { flag: "wx" });
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(fixture, "preview.ps1"),
    "-TargetScript", path.join(checkout, "scripts/smoke-fresh-install.ps1"), "-ArgumentsFile", path.join(fixture, "arguments.json"),
    "-DockerLog", path.join(fixture, "docker-calls.txt")];
  save("invocation.json", { identity, executable: powershell, args, cwd: path.join(fixture, "outside"), timeout_ms: 10000,
    trace_binding: { file: "prelude-stages.jsonl", probe: "DEBUG-pwsh-20260930", exclusive_file: true },
    changed_environment: { PATH: "", TEMP: path.join(fixture, "temp"), TMP: path.join(fixture, "temp"), TMPDIR: path.join(fixture, "temp"),
      npm_package_version: "99.0.0", APP_VERSION: "97.0.0", POWERSHELL_TELEMETRY_OPTOUT: "1", POWERSHELL_UPDATECHECK: "Off", ZHILIAO_PREVIEW_TRACE_FILE: trace } });
  const summary = capturePrelude({ identity, save,
    readTrace: () => ({ identity: JSON.parse(fs.readFileSync(path.join(output, "identity.json"), "utf8")), text: fs.readFileSync(trace, "utf8") }),
    invoke: () => invokeProcess(powershell, args, { cwd: path.join(fixture, "outside"), encoding: "utf8", timeout: 10000,
      env: { ...process.env, PATH: "", TEMP: path.join(fixture, "temp"), TMP: path.join(fixture, "temp"), TMPDIR: path.join(fixture, "temp"),
        npm_package_version: "99.0.0", APP_VERSION: "97.0.0", POWERSHELL_TELEMETRY_OPTOUT: "1", POWERSHELL_UPDATECHECK: "Off", ZHILIAO_PREVIEW_TRACE_FILE: trace } }) });
  try {
    const after = snapshot(); save("fixture-after.json", after); assert.deepEqual(after, before, "fixture 输入变化");
  } catch (error) {
    const item = { source: "fixture-after", message: String(error) };
    if (summary.primary_error) summary.secondary_errors.push(item); else summary.primary_error = item;
    summary.status = "stop";
  }
  try { save("final-result.json", summary); }
  catch (error) {
    const item = { source: "final-result.json", message: String(error) };
    if (summary.primary_error) summary.secondary_errors.push(item); else summary.primary_error = item;
    summary.status = "stop";
  }
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv[2], "--run-prelude", "只可在明确授权后调用 --run-prelude；导入模块不启动进程");
  const summary = runPreludeProbe(process.argv[3], process.argv[4]);
  console.log(JSON.stringify(summary));
  if (summary.status !== "passed") process.exitCode = 1;
}
