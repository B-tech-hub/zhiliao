import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import {
  assertNativePlatform, baseMaterials, cleanupResources, finishStatus,
  registryClient, releaseTags, validateImageConfig, validateIndex,
} from "../../scripts/verify-release-gate4.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const revision = "a".repeat(40);
const imageType = "application/vnd.oci.image.manifest.v1+json";
function descriptor(architecture: string, id: string) {
  return { mediaType: imageType, size: 321, digest: digest(id), platform: { os: "linux", architecture } };
}
function fixture() {
  return {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [descriptor("amd64", "1"), descriptor("arm64", "2")],
  };
}
const expected = [{ platform: "linux/amd64", digest: digest("1") }, { platform: "linux/arm64", digest: digest("2") }];

afterEach(() => vi.unstubAllGlobals());

describe("真实分发身份断言", () => {
  it("要求两种运行架构，attestation 不占运行平台名额", () => {
    const index = fixture();
    const attestation = {
      mediaType: imageType, size: 100, digest: digest("3"),
      platform: { os: "unknown", architecture: "unknown" },
      annotations: { "vnd.docker.reference.type": "attestation-manifest", "vnd.docker.reference.digest": digest("1") },
    };
    index.manifests.push(attestation);
    expect(validateIndex(index, expected)).toMatchObject({ runtime: expected, attestations: [attestation] });
    index.manifests.splice(1, 1);
    expect(() => validateIndex(index, expected)).toThrow(/集合不完整/);
  });

  it.each(["duplicate", "extra", "wrong-digest", "empty", "nested", "bad-size"])("拒绝不完整或被替换的索引：%s", (scenario) => {
    const index = fixture();
    if (scenario === "duplicate") index.manifests.push(descriptor("amd64", "4"));
    if (scenario === "extra") index.manifests.push(descriptor("s390x", "4"));
    if (scenario === "wrong-digest") index.manifests[0].digest = digest("4");
    if (scenario === "empty") index.manifests = [];
    if (scenario === "nested") index.manifests[0].mediaType = index.mediaType;
    if (scenario === "bad-size") index.manifests[0].size = -1;
    expect(() => validateIndex(index, expected)).toThrow();
  });

  it("拒绝无归属 attestation 和未知伪平台", () => {
    const index = fixture();
    const attestation = {
      mediaType: imageType, size: 100, digest: digest("3"),
      platform: { os: "unknown", architecture: "unknown" },
      annotations: { "vnd.docker.reference.type": "attestation-manifest", "vnd.docker.reference.digest": digest("9") },
    };
    index.manifests.push(attestation);
    expect(() => validateIndex(index, expected)).toThrow(/未知运行镜像/);
    attestation.annotations["vnd.docker.reference.type"] = "other";
    expect(() => validateIndex(index, expected)).toThrow(/额外架构/);
  });

  it("同时校验原生 runner、镜像配置架构和完整 revision", () => {
    assertNativePlatform("linux/amd64", "linux", "x64");
    assertNativePlatform("linux/arm64", "linux", "arm64");
    expect(() => assertNativePlatform("linux/arm64", "linux", "x64")).toThrow(/原生架构/);
    expect(() => assertNativePlatform("linux/amd64", "win32", "x64")).toThrow(/Linux/);
    const config = { os: "linux", architecture: "amd64", config: { Labels: { "org.opencontainers.image.revision": revision } } };
    validateImageConfig(config, "linux/amd64", revision);
    expect(() => validateImageConfig(config, "linux/arm64", revision)).toThrow(/架构/);
    expect(() => validateImageConfig(config, "linux/amd64", "b".repeat(40))).toThrow(/revision/);
    expect(() => validateImageConfig(config, "linux/amd64", "aaaaaaa")).toThrow(/完整/);
  });

  it("RC 只生成自身固定标签，不能提前移动 latest 或次版本标签", () => {
    expect(releaseTags("v0.6.1-rc1", "0.6.1")).toEqual(["ghcr.io/b-tech-hub/zhiliao:0.6.1-rc1"]);
    expect(releaseTags("v0.6.1", "0.6.1")).toEqual([
      "ghcr.io/b-tech-hub/zhiliao:0.6.1", "ghcr.io/b-tech-hub/zhiliao:0.6", "ghcr.io/b-tech-hub/zhiliao:latest",
    ]);
    for (const tag of ["v0.6.2-rc1", "v0.6.1-rc01", "latest", "v0.6.1-rc1\n"]) {
      expect(() => releaseTags(tag, "0.6.1")).toThrow();
    }
  });

  it("只记录构建实际使用的基础镜像，缺少 provenance 时失败", () => {
    const material = { uri: "pkg:docker/node@22-bookworm-slim?platform=linux%2Famd64", digest: { sha256: "1".repeat(64) } };
    expect(baseMaterials({ "buildx.build.provenance": { materials: [material] } })).toEqual([material]);
    expect(() => baseMaterials({})).toThrow(/provenance/);
    expect(() => baseMaterials({ "buildx.build.provenance": { materials: [] } })).toThrow(/基础镜像/);
  });

  it("匿名 registry 请求验证原始字节 digest，不接受同 tag 下被改写的数据", async () => {
    const body = Buffer.from(JSON.stringify(fixture()));
    const expectedDigest = `sha256:${crypto.createHash("sha256").update(body).digest("hex")}`;
    const mock = vi.fn(async (url: string) => url.includes("/token?")
      ? new Response(JSON.stringify({ token: "synthetic-anonymous-token" }))
      : new Response(body, { headers: { "docker-content-digest": expectedDigest } }));
    vi.stubGlobal("fetch", mock);
    const client = registryClient();
    expect((await client.manifest(expectedDigest)).digest).toBe(expectedDigest);
    expect(mock.mock.calls[0][0]).toContain("scope=repository:b-tech-hub/zhiliao:pull");
    await expect(client.manifest(digest("8"))).rejects.toThrow(/原始字节/);
    await expect(client.manifest("latest")).rejects.toThrow(/必须固定/);
  });
});

describe("清理与失败结果", () => {
  function dockerStub(options: { foreign?: boolean; removeFails?: boolean; remains?: boolean } = {}) {
    const calls: string[][] = [];
    const invoke = async (args: string[]) => {
      calls.push(args);
      if (args[1] === "ls") {
        if (args.includes("--quiet")) return options.remains ? "container-id" : "";
        return args[0] === "container" ? "container-id" : "owned-volume";
      }
      if (args[1] === "inspect") return JSON.stringify({ "io.zhiliao.gate4.run": options.foreign && args[0] === "volume" ? "other-run" : "this-run" });
      if (options.removeFails && args[1] === "rm") throw new Error("模拟删除失败");
      return "";
    };
    return { calls, invoke };
  }

  it("先核对所有资源归属，存在外来卷时一个资源也不删除", async () => {
    const docker = dockerStub({ foreign: true });
    await expect(cleanupResources(docker.invoke, "this-run")).rejects.toThrow(/归属/);
    expect(docker.calls.some((args) => args[1] === "rm")).toBe(false);
    expect(docker.calls.filter((args) => args[1] === "inspect").every((args) => args.includes("--format"))).toBe(true);
  });

  it("成功清理后复查剩余资源，删除失败或仍有资源不能通过", async () => {
    const success = dockerStub();
    expect(await cleanupResources(success.invoke, "this-run")).toMatchObject({ status: "passed" });
    expect(success.calls.filter((args) => args[1] === "rm").map((args) => args[0])).toEqual(["container", "volume"]);
    await expect(cleanupResources(dockerStub({ removeFails: true }).invoke, "this-run")).rejects.toThrow(/清理失败/);
    await expect(cleanupResources(dockerStub({ remains: true }).invoke, "this-run")).rejects.toThrow(/仍有本轮资源/);
  });

  it.each([[false, true, undefined], [true, false, undefined], [true, true, "超时"]])("运行或清理失败时汇总为 failed", (checks, cleanup, error) => {
    expect(finishStatus(checks, cleanup, error)).toBe("failed");
  });
  it("全部运行检查和清理成功才汇总为 passed", () => {
    expect(finishStatus(true, true, undefined)).toBe("passed");
  });
});

describe("发布工作流保护", () => {
  const workflow = YAML.parse(fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8"));
  type Step = { uses?: string; run?: string; if?: string; with?: Record<string, unknown> };

  it("tag 仍是唯一入口，GitHub Release 等待两种原生架构的安装和清理", () => {
    expect(Object.keys(workflow.on)).toEqual(["push"]);
    expect(workflow.on.push.tags).toEqual(["v*.*.*"]);
    expect(workflow.jobs.release.needs).toEqual(expect.arrayContaining(["merge", "install"]));
    for (const name of ["build", "install"]) {
      const job = workflow.jobs[name];
      expect(job.strategy["max-parallel"]).toBe(1);
      expect(job.strategy.matrix.include.map((item: { platform: string; runner: string }) => [item.platform, item.runner])).toEqual([
        ["linux/amd64", "ubuntu-24.04"], ["linux/arm64", "ubuntu-24.04-arm"],
      ]);
      expect(job["continue-on-error"]).toBeUndefined();
    }
    const stop = workflow.jobs.install.steps.find((step: Step) => step.run?.includes("SIGTERM"));
    expect(stop.if).toBe("always() && steps.daemon.outputs.owned == 'true'");
    expect(stop.run).toContain("daemon 归属不匹配");
    expect(stop.run).toContain('sys.exit(1 if result["status"] == "failed" else 0)');
  });

  it("构建不恢复应用缓存且记录 provenance，失败仍上传证据", () => {
    const steps: Step[] = Object.values(workflow.jobs).flatMap((job) => (job as { steps: Step[] }).steps);
    for (const step of steps) {
      expect(step.uses ?? "").not.toContain("setup-qemu");
      expect(step.uses ?? "").not.toMatch(/^actions\/cache/);
      expect(step.with?.["cache-from"]).toBeUndefined();
      expect(step.with?.["cache-to"]).toBeUndefined();
      if (step.uses?.startsWith("actions/setup-node")) expect(step.with?.cache).toBeUndefined();
      if (step.uses?.startsWith("actions/checkout")) expect(step.with?.ref).toBe("${{ github.sha }}");
    }
    const build = steps.find((step) => step.uses?.startsWith("docker/build-push-action"));
    expect(build?.with).toMatchObject({ "no-cache": true, pull: true, provenance: "mode=max" });
    for (const name of ["build", "merge", "install"]) {
      const upload = workflow.jobs[name].steps.find((step: Step) => step.uses?.startsWith("actions/upload-artifact"));
      expect(upload.if).toBe("always()");
      expect(upload.with["if-no-files-found"]).toBe("error");
    }
  });

  it("安装 job 不登录 registry，专用 daemon 与空配置不接触宿主已有存储", () => {
    const job = workflow.jobs.install;
    expect(job.permissions).toEqual({ contents: "read" });
    expect(job.steps.some((step: Step) => step.uses?.includes("login-action"))).toBe(false);
    expect(job.env.DOCKER_HOST).toContain("gate4-docker/docker.sock");
    expect(job.env.DOCKER_CONFIG).toContain("gate4-anonymous");
    const start = job.steps.find((step: Step) => step.run?.includes("nohup dockerd"));
    expect(start.run).toContain('test ! -e "$daemon"');
    expect(start.run).toContain('--data-root="$daemon/data"');
    expect(start.run).toContain('--config-file="$daemon/config.json"');
    expect(start.run.indexOf('test ! -e "$daemon"')).toBeLessThan(start.run.indexOf('echo "owned=true"'));
    expect(start.run).toContain("printf '{}\\n'");
    expect(start.run).not.toContain("prune");
  });

  it("帮助和错误输入不调用 Docker、Git 或 registry", () => {
    const script = path.join(root, "scripts/verify-release-gate4.mjs");
    const env = { ...process.env, GITHUB_ACTIONS: "false", PATH: "" };
    const help = spawnSync(process.execPath, [script, "--help"], { env, encoding: "utf8", windowsHide: true, timeout: 5000 });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("merge 会推送");
    const blocked = spawnSync(process.execPath, [script, "install", "--output", "unused"], { env, encoding: "utf8", windowsHide: true, timeout: 5000 });
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain("已确认的 GitHub Actions");
  });
});
