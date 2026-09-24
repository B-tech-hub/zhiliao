import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, RUN_DEADLINE_MS, SLEEP_GAP_MS, compareSnapshots, isTransientOrganizeError, parseStandbyIndexes, sleepDetected, sleepGapMs } from "../../scripts/verify-r1-core-loop.mjs";

const repository = path.resolve(import.meta.dirname, "../..");
const script = fs.readFileSync(path.join(repository, "scripts/verify-r1-core-loop.mjs"), "utf8");

describe("R1 核心闭环编排夹具", () => {
  it("合成笔记互不包含对方的搜索词和拒答主题", () => {
    expect(FIXTURES.notes.A).toContain("羽毛球");
    expect(FIXTURES.notes.B).toContain("Markdown 表格");
    expect(FIXTURES.notes.C).toContain("叶绿素");
    expect(FIXTURES.notes.A).not.toContain("茶树");
    expect(FIXTURES.notes.B).not.toContain("羽毛球");
    expect(FIXTURES.notes.C).not.toContain("Markdown");
    expect(FIXTURES.citeQuestion).toContain("羽毛球");
    expect(FIXTURES.refuseQuestion).toContain("茶树");
  });

  it("只使用隔离数据目录，并复用无模型证据", () => {
    expect(script).toContain("data-r1-core");
    expect(script).toContain('DATABASE_PATH: path.join(DATA_ROOT, "db", "app.db")');
    expect(script).not.toMatch(/DATABASE_PATH:\s*["']\.\/data\/db\/app\.db["']/);
    expect(script).toContain("docs/R1安装验收-2026-09-15.md");
    expect(script).toContain("来源笔记中没有相关内容");
    expect(script).toContain('EMBEDDING_API_KEY: ""');
  });

  it("用墙钟和单调时钟的差值识别睡眠，并设整体截止", () => {
    expect(sleepGapMs(10_000, 9_000)).toBe(1_000);
    expect(sleepDetected(10_000, 9_000, SLEEP_GAP_MS)).toBe(false);
    expect(sleepDetected(20_000, 1_000)).toBe(true);
    expect(RUN_DEADLINE_MS).toBe(180_000 + 480_000 + 480_000 + 120_000 * 2 + 45_000 + 120_000);
    expect(script).toContain("SetThreadExecutionState");
    expect(script).toContain("STANDBYIDLE");
    expect(script).toContain("sleep_detected");
  });

  it("能从中英文电源查询里读出待机秒数", () => {
    const zh = [
      "GUID 别名: STANDBYIDLE",
      "当前交流电源设置索引: 0x00000000",
      "当前直流电源设置索引: 0x00000258",
    ].join("\n");
    expect(parseStandbyIndexes(zh)).toEqual({ ac_sec: 0, dc_sec: 600 });
    const en = [
      "GUID Alias: STANDBYIDLE",
      "Current AC Power Setting Index: 0x00000708",
      "Current DC Power Setting Index: 0x00000000",
    ].join("\n");
    expect(parseStandbyIndexes(en)).toEqual({ ac_sec: 1800, dc_sec: 0 });
  });

  it("运行中新建的数据目录也算变化", () => {
    const before = { data: { exists: true, files: 1, digest: "a" } };
    const after = {
      data: { exists: true, files: 1, digest: "a" },
      "data-extra": { exists: true, files: 1, digest: "b" },
    };
    expect(compareSnapshots(before, after)).toEqual(["data-extra"]);
    expect(compareSnapshots(after, before)).toEqual(["data-extra"]);
  });

  it("只把瞬时 429、5xx 或超时视为可补整理", () => {
    expect(isTransientOrganizeError("LLM 请求失败 HTTP 429: 当前分组上游负载已饱和")).toBe(true);
    expect(isTransientOrganizeError("LLM 请求失败 HTTP 500: Internal error")).toBe(true);
    expect(isTransientOrganizeError("The operation was aborted due to timeout")).toBe(true);
    expect(isTransientOrganizeError("无效的 API Key")).toBe(false);
    expect(isTransientOrganizeError("")).toBe(false);
    expect(script).toContain("只补整理一次");
  });
});
