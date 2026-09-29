import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repository = path.resolve(import.meta.dirname, "../..");
const shellName = process.platform === "win32" ? "powershell.exe" : "pwsh";
const powershell = (process.env.PATH ?? "").split(path.delimiter)
  .map((directory) => path.join(directory.replace(/^"|"$/g, ""), shellName))
  .find((candidate) => fs.existsSync(candidate));
const fixtureVersion = "1.2.3";
const imagePrefix = "ghcr.io/b-tech-hub/zhiliao";
const port = 3317;
// 外层预算需覆盖 PowerShell 的 10 秒进程上限及启动、快照和断言开销。
const previewTestTimeoutMs = 15_000;

function snapshotTree(root: string) {
  const entries: Record<string, string> = {};
  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        entries[`${relative}/`] = "directory";
        visit(absolute);
      } else {
        entries[relative] = createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
      }
    }
  }
  visit(root);
  return entries;
}

// 本机可明确跳过缺少 PowerShell 的环境；CI 必须执行，不能静默丢失这组门禁。
describe.skipIf(!powershell && !process.env.CI)("安装冒烟预览：参数与零部署副作用", () => {
  let directory = "";

  beforeEach(() => {
    if (!powershell) throw new Error(`预览回归需要 ${shellName}；CI 不允许跳过，请安装 PowerShell 并加入 PATH`);
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-smoke-preview-"));
    const checkout = path.join(directory, "checkout with spaces");
    for (const folder of ["scripts", "docs"]) fs.mkdirSync(path.join(checkout, folder), { recursive: true });
    fs.mkdirSync(path.join(directory, "outside"));
    fs.mkdirSync(path.join(directory, "temp"));
    fs.copyFileSync(path.join(repository, "scripts/smoke-fresh-install.ps1"), path.join(checkout, "scripts/smoke-fresh-install.ps1"));
    fs.writeFileSync(path.join(checkout, "package.json"), JSON.stringify({ version: fixtureVersion }));
    fs.writeFileSync(path.join(directory, "outside/package.json"), JSON.stringify({ version: "98.0.0" }));
    // 在独立进程中拦截 Docker，即使预览提前退出失效，也不会接触真实容器。
    fs.writeFileSync(path.join(directory, "preview.ps1"), [
      "param([string]$TargetScript, [string]$ArgumentsFile, [string]$DockerLog)",
      '$ErrorActionPreference = "Stop"',
      "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
      "$global:PreviewDockerLog = $DockerLog",
      "function global:docker {",
      '  [IO.File]::AppendAllText($global:PreviewDockerLog, "called")',
      '  throw "Docker is forbidden in preview tests."',
      "}",
      "$parameters = @{}",
      "$config = Get-Content -Raw -Encoding UTF8 -LiteralPath $ArgumentsFile | ConvertFrom-Json",
      "foreach ($property in $config.PSObject.Properties) { $parameters[$property.Name] = $property.Value }",
      "& $TargetScript @parameters",
      "exit $LASTEXITCODE",
      "",
    ].join("\n"));
  });

  afterEach(() => {
    if (!directory) return;
    const resolved = fs.realpathSync(directory);
    if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith("zhiliao-smoke-preview-")) {
      throw new Error("预览测试目录越界，拒绝清理");
    }
    fs.rmSync(resolved, { recursive: true, force: true });
    directory = "";
  });

  function preview(image?: string) {
    if (!powershell) throw new Error(`未找到 ${shellName}`);
    const argumentsFile = path.join(directory, "arguments.json");
    fs.writeFileSync(argumentsFile, JSON.stringify({ PrintConfig: true, KeepResources: true, Port: port, ...(image === undefined ? {} : { Image: image }) }));
    const before = snapshotTree(directory);
    const result = spawnSync(powershell, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", path.join(directory, "preview.ps1"),
      "-TargetScript", path.join(directory, "checkout with spaces/scripts/smoke-fresh-install.ps1"),
      "-ArgumentsFile", argumentsFile, "-DockerLog", path.join(directory, "docker-calls.txt"),
    ], {
      cwd: path.join(directory, "outside"), encoding: "utf8", windowsHide: true, timeout: 10_000,
      env: {
        ...process.env,
        PATH: "",
        TEMP: path.join(directory, "temp"), TMP: path.join(directory, "temp"), TMPDIR: path.join(directory, "temp"),
        npm_package_version: "99.0.0", APP_VERSION: "97.0.0",
        POWERSHELL_TELEMETRY_OPTOUT: "1", POWERSHELL_UPDATECHECK: "Off",
      },
    });
    expect(result.error).toBeUndefined();
    expect(fs.existsSync(path.join(directory, "docker-calls.txt")), "预览不得调用 Docker").toBe(false);
    expect(snapshotTree(directory), "预览不得创建资源或改写输入文件").toEqual(before);
    return result;
  }

  it.each([
    ["默认包版本", undefined],
    ["历史固定版本", `${imagePrefix}:0.6.0`],
    ["RC", `${imagePrefix}:1.2.3-rc1`],
    ["点分 RC", `${imagePrefix}:1.2.3-rc.1`],
    ["digest", `${imagePrefix}@sha256:${"a".repeat(64)}`],
  ])("%s：输出正确镜像，且不依赖运行目录或环境版本", (_name, image) => {
    const result = preview(image);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ packageVersion: fixtureVersion, image: image ?? `${imagePrefix}:${fixtureVersion}`, port });
  }, previewTestTimeoutMs);

  it.each([
    ["latest", `${imagePrefix}:latest`],
    ["浮动次版本", `${imagePrefix}:0.6`],
    ["错误仓库", "ghcr.io/another/zhiliao:1.2.3"],
    ["错误摘要", `${imagePrefix}@sha256:${"a".repeat(63)}`],
    ["错误 RC", `${imagePrefix}:1.2.3-rc01`],
    ["末尾换行", `${imagePrefix}:1.2.3\n`],
  ])("拒绝 %s，失败前后均无部署副作用", (_name, image) => {
    const result = preview(image);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Image");
  }, previewTestTimeoutMs);
});
