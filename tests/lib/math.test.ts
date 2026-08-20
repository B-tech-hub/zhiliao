import { describe, expect, it } from "vitest";
import { appendTranscriptionBlock, mathMarkdownToEditorHtml, normalizeMathMarkdown } from "@/lib/math";

describe("数学 Markdown 契约", () => {
  it("保留代码块中的美元符号并检查未闭合公式", () => {
    const result = normalizeMathMarkdown("公式 $x^2$\n```js\nconst s = '$x'\n```");
    expect(result.markdown).toContain("$x^2$");
    expect(result.warnings).toEqual([]);
  });

  it("追加转写块而不覆盖原文", () => {
    const result = appendTranscriptionBlock("原文", "$x$", "/api/images/a.png");
    expect(result).toContain("原文");
    expect(result).toContain("手写转写（待核对）");
    expect(result).toContain("$x$");
  });

  it("把公式转为编辑器节点并跳过代码块", () => {
    const result = mathMarkdownToEditorHtml("行内 $x^2$\n```txt\n$raw$\n```");
    expect(result).toContain('data-latex="x^2"');
    expect(result).toContain("\n$raw$\n");
  });
});
