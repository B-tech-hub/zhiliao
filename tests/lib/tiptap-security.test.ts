// @vitest-environment jsdom
import { createRequire } from "node:module";
import { mergeAttributes } from "@tiptap/core";
import { DOMSerializer, Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const commonjs = require("@tiptap/core") as { mergeAttributes: typeof mergeAttributes };

describe.each([
  ["ESM", mergeAttributes],
  ["CommonJS", commonjs.mergeAttributes],
] as const)("TipTap 属性安全：%s", (_format, merge) => {
  it.each([0, 1, 2])("自有 __proto__ 位于第 %i 个对象时不改变原型", (position) => {
    // 只使用数据标记和空事件值，不请求图片或执行脚本。
    const input = JSON.parse('{"__proto__":{"data-tiptap-canary":"present","onerror":""}}');
    const objects = [{ title: "保留标题" }, { class: "note" }];
    objects.splice(position, 0, input);
    const result = merge(...objects);

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect("data-tiptap-canary" in result).toBe(false);
    expect("onerror" in result).toBe(false);
    expect(result.title).toBe("保留标题");
    expect(result.class).toBe("note");
    expect(Object.hasOwn(Object.prototype, "data-tiptap-canary")).toBe(false);
  });

  it("DOMSerializer 不把继承标记或事件属性写入图片", () => {
    const attributes = merge(JSON.parse(
      '{"alt":"正常说明","__proto__":{"data-tiptap-canary":"present","onerror":""}}',
    ));
    const schema = new Schema({
      nodes: {
        doc: { content: "image" },
        image: { toDOM: () => ["img", attributes] },
        text: {},
      },
    });
    const fragment = DOMSerializer.fromSchema(schema).serializeFragment(
      schema.node("doc", null, [schema.node("image")]).content,
      { document: document.implementation.createHTMLDocument() },
    );
    const image = fragment.firstChild as HTMLImageElement;
    expect(image.tagName).toBe("IMG");
    expect(image.getAttribute("alt")).toBe("正常说明");
    expect(image.hasAttribute("data-tiptap-canary")).toBe(false);
    expect(image.hasAttribute("onerror")).toBe(false);
  });

  it("保留普通属性覆盖、class 去重和 style 合并", () => {
    expect(merge(
      { title: "旧", class: "note wide", style: "color: red; width: 50%" },
      { title: "新", class: "wide selected", style: "color: blue; margin-left: auto" },
    )).toEqual({
      title: "新", class: "note wide selected",
      style: "color: blue; width: 50%; margin-left: auto",
    });
  });

  it("忽略输入中原本继承的属性", () => {
    const inherited = Object.create({ "data-tiptap-canary": "present" });
    inherited.title = "正常标题";
    expect(merge(inherited)).toEqual({ title: "正常标题" });
  });
});
