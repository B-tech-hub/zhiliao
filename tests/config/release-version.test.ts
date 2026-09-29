import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ts from "typescript";
import YAML from "yaml";
import { version as workspaceVersion } from "../../package.json";
import { checkReleaseVersion } from "../../scripts/check-release-version.mjs";

const repository = path.resolve(import.meta.dirname, "../..");
const fixtureVersion = "1.2.3";
const fixtureImage = `ghcr.io/b-tech-hub/zhiliao:${fixtureVersion}`;

describe("发布版本一致性", () => {
  let root: string;

  function write(file: string, source: string) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source, "utf8");
  }

  function json(file: string, value: unknown) {
    write(file, JSON.stringify(value));
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-release-version-"));
    json("package.json", { version: fixtureVersion });
    json("package-lock.json", { version: fixtureVersion, packages: { "": { version: fixtureVersion } } });
    write("docker-compose.yml", YAML.stringify({ services: { app: { image: fixtureImage } } }));
    write("docker-compose.demo.yml", YAML.stringify({ services: { app: { image: fixtureImage }, mockllm: { image: fixtureImage } } }));
    write("docker-compose.win.yml", "services:\n  app:\n    volumes: []\n");
    write(`docs/releases/v${fixtureVersion}.md`, `# v${fixtureVersion}：候选说明\n\n旧版本 v0.6.0 的证据不改写。\n`);
    write("CHANGELOG.md", `# 更新日志\n\n## [未发布] - ${fixtureVersion} 候选\n\n## [0.6.0] - 2026-08-30\n`);
  });

  afterEach(() => {
    // 仅清理本用例在系统临时目录中创建的夹具。
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("zhiliao-release-version-")) {
      throw new Error("夹具目录越界，拒绝清理");
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([undefined, "v1.2.3", "v1.2.3-rc1", "v1.2.3-rc.1", "v1.2.3-beta2", "v1.2.3-alpha.0"])("接受匹配的基础版本与 tag %s", (tag) => {
    expect(checkReleaseVersion({ root, tag })).toMatchObject({ version: fixtureVersion, image: fixtureImage });
  });

  it.each(["v1.2.4", "1.2.3", "v01.2.3", "v1.2.3-rc", "v1.2.3-rc01", "v1.2.3-rc.01", "v1.2.3-dev1", "v1.2.3+build", "v1.2.3\n", ""])("拒绝不匹配或不支持的 tag %s", (tag) => {
    expect(() => checkReleaseVersion({ root, tag })).toThrow(/tag/);
  });

  it.each([undefined, "latest", "1.2", "01.2.3", "1.2.3-rc1", "1.2.3\n", 123])("拒绝无效的包基础版本 %s", (version) => {
    json("package.json", { version });
    expect(() => checkReleaseVersion({ root })).toThrow(/package.json.version/);
  });

  it.each(["top", "root"])("发现 lockfile 的 %s 版本漂移", (field) => {
    json("package-lock.json", {
      version: field === "top" ? "0.6.0" : fixtureVersion,
      packages: { "": { version: field === "root" ? "0.6.0" : fixtureVersion } },
    });
    expect(() => checkReleaseVersion({ root })).toThrow(/package-lock.json/);
  });

  it.each([
    ["docker-compose.yml", "app"],
    ["docker-compose.demo.yml", "app"],
    ["docker-compose.demo.yml", "mockllm"],
  ])("发现 %s 的 %s 镜像漂移", (file, service) => {
    const compose = YAML.parse(fs.readFileSync(path.join(root, file), "utf8"));
    compose.services[service].image = "ghcr.io/b-tech-hub/zhiliao:latest";
    write(file, YAML.stringify(compose));
    expect(() => checkReleaseVersion({ root })).toThrow(`${file} services.${service}.image`);
  });

  it("发现 Windows override 覆盖成旧镜像", () => {
    write("docker-compose.win.yml", "services:\n  app:\n    image: ghcr.io/b-tech-hub/zhiliao:0.6.0\n");
    expect(() => checkReleaseVersion({ root })).toThrow(/docker-compose.win.yml/);
  });

  it("发布说明缺失时失败，不回落到旧版本说明", () => {
    fs.unlinkSync(path.join(root, `docs/releases/v${fixtureVersion}.md`));
    write("docs/releases/v0.6.0.md", "# v0.6.0\n");
    expect(() => checkReleaseVersion({ root })).toThrow(`docs/releases/v${fixtureVersion}.md`);
  });

  it("发现错误的发布说明标题", () => {
    write(`docs/releases/v${fixtureVersion}.md`, "# v1.2.30\n");
    expect(() => checkReleaseVersion({ root })).toThrow(/一级标题/);
  });

  it("不能用更新日志正文中的目标版本掩盖错误的首个版本段", () => {
    write("CHANGELOG.md", `# 更新日志\n\n## [0.6.0]\n\n稍后准备 ${fixtureVersion}。\n`);
    expect(() => checkReleaseVersion({ root })).toThrow(/CHANGELOG.md/);
  });

  it("接受正式更新日志标题，并保留历史段落", () => {
    write("CHANGELOG.md", `# 更新日志\n\n## [${fixtureVersion}] - 2026-09-13\n\n## [0.6.0]\n`);
    expect(checkReleaseVersion({ root }).version).toBe(fixtureVersion);
  });

  it.each([
    ["package-lock.json", "{"],
    ["docker-compose.yml", "services: ["],
  ])("%s 无法解析时明确失败", (file, source) => {
    write(file, source);
    expect(() => checkReleaseVersion({ root })).toThrow(`${file} 无法读取或解析`);
  });
});

describe("当前仓库的发布接线", () => {
  it("当前分发文件与包版本一致", () => {
    expect(checkReleaseVersion().version).toBe(workspaceVersion);
  });

  it("TypeScript 调用可传入 tag，导出参数类型与运行契约一致", () => {
    const config = ts.readConfigFile(path.join(repository, "tsconfig.json"), ts.sys.readFile);
    expect(config.error).toBeUndefined();
    const converted = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, repository);
    expect(converted.errors).toEqual([]);
    // 只检查本文件的真实调用，不运行 Next 构建，也不写入增量类型缓存。
    const target = path.join(repository, "tests/config/release-version.test.ts");
    const program = ts.createProgram([target], { ...converted.options, noEmit: true, incremental: false });
    const source = program.getSourceFile(target);
    if (!source) throw new Error("未加载发布版本测试文件");
    const diagnostics = program.getSemanticDiagnostics(source).map((item) => {
      const line = source.getLineAndCharacterOfPosition(item.start ?? 0).line + 1;
      return `${line}: TS${item.code} ${ts.flattenDiagnosticMessageText(item.messageText, " ")}`;
    });
    expect(diagnostics).toEqual([]);
  }, 10_000);

  it("从仓库外启动 CLI 也使用脚本所属仓库，并返回正确退出码", () => {
    const script = path.join(repository, "scripts/check-release-version.mjs");
    const options = { cwd: os.tmpdir(), encoding: "utf8" as const, windowsHide: true, timeout: 10_000 };
    const matching = spawnSync(process.execPath, [script, "--tag", `v${workspaceVersion}-rc1`], options);
    expect(matching.error).toBeUndefined();
    expect(matching.status).toBe(0);
    expect(matching.stdout).toContain(workspaceVersion);
    const wrong = spawnSync(process.execPath, [script, "--tag", "v99.99.99"], options);
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain("不一致");
    const missing = spawnSync(process.execPath, [script, "--tag"], options);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("用法");
  });

  it("发布构建等待版本校验，原四条门禁和双架构保留", () => {
    const release = YAML.parse(fs.readFileSync(path.join(repository, ".github/workflows/release.yml"), "utf8"));
    for (const name of ["build_amd64", "build_arm64"]) expect(release.jobs[name].needs).toContain("validate");
    expect(release.jobs.build_arm64.needs).toContain("build_amd64");
    expect(release.jobs.merge.needs).toEqual(["build_amd64", "build_arm64"]);
    expect(release.jobs.release.needs).toContain("merge");
    const validationRuns = release.jobs.validate.steps.map((step: { run?: string }) => step.run).filter(Boolean);
    expect(validationRuns).toContain('npm run check:version -- --tag "$GITHUB_REF_NAME"');
    expect([release.jobs.build_amd64.env.PLATFORM, release.jobs.build_arm64.env.PLATFORM]).toEqual(["linux/amd64", "linux/arm64"]);
    const ci = YAML.parse(fs.readFileSync(path.join(repository, ".github/workflows/ci.yml"), "utf8"));
    const commands = ci.jobs.build.steps.map((step: { run?: string }) => step.run).filter(Boolean);
    expect(commands).toEqual(["npm ci", "npm run check:version", "npm run check:design", "npm run lint", "npm test", "npm run build"]);
  });
});
