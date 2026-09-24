import { describe, expect, it } from "vitest";
import { enforceSourceRefusal, SOURCE_REFUSAL_SENTENCE } from "@/lib/ai/source-refusal";

describe("来源拒答固定句", () => {
  it("已经是固定句时不改写", () => {
    const text = `${SOURCE_REFUSAL_SENTENCE}。缺的是茶树种植环境。`;
    expect(enforceSourceRefusal(text)).toBe(text);
  });

  it("把嵌进主题的拒答收成固定句，并保留后续说明", () => {
    const raw = "来源笔记中没有关于「茶树种植环境」的相关内容。\n\n当前处于来源问答模式，建议新建普通对话。";
    const out = enforceSourceRefusal(raw);
    expect(out.startsWith(SOURCE_REFUSAL_SENTENCE)).toBe(true);
    expect(out).toContain("建议新建普通对话");
    expect(out).not.toContain("没有关于");
  });

  it("其它拒答说法补上固定句", () => {
    const out = enforceSourceRefusal("来源里没有茶树种植的记录。");
    expect(out.startsWith(`${SOURCE_REFUSAL_SENTENCE}。`)).toBe(true);
    expect(out).toContain("茶树种植的记录");
  });

  it("已引用来源的回答保持原样", () => {
    const raw = "羽毛球练习安排在每周二早上[^note-a]。";
    expect(enforceSourceRefusal(raw)).toBe(raw);
  });

  it("空文本保持为空", () => {
    expect(enforceSourceRefusal("")).toBe("");
  });

  it("白名单引用即使嵌了主题也不改写", () => {
    const raw = "来源笔记中没有关于茶树的相关内容[^n1]。";
    expect(enforceSourceRefusal(raw, new Set(["n1"]))).toBe(raw);
    expect(enforceSourceRefusal("来源里没有茶树[^noteId:n1]。", new Set(["n1"]))).toBe("来源里没有茶树[^noteId:n1]。");
  });

  it("伪造脚注挡不住固定句", () => {
    const out = enforceSourceRefusal("来源里没有茶树种植的记录[^noteId:fake]。", new Set(["n1"]));
    expect(out.startsWith("来源笔记中没有相关内容。")).toBe(true);
    expect(out).toContain("[^noteId:fake]");
  });

  it("没有相关内容单独出现时不改写", () => {
    const raw = "笔记写了训练安排，没有相关内容指向别的事。";
    expect(enforceSourceRefusal(raw)).toBe(raw);
  });
});
