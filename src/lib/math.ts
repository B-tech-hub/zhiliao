export interface MathNormalizationResult { markdown: string; warnings: string[] }

// 统一视觉模型公式分隔符，并保护代码块内容。
export function normalizeMathMarkdown(input: string): MathNormalizationResult {
  const warnings: string[] = [];
  let inFence = false;
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const markdown = lines.map((line) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;
    let value = line.replace(/\\\[/g, "$$\n").replace(/\\\]/g, "\n$$");
    value = value.replace(/\\\(/g, "$").replace(/\\\)/g, "$");
    const dollars = (value.match(/(?<!\\)\$/g) ?? []).length;
    if (dollars % 2 !== 0) warnings.push("存在未闭合的数学分隔符，已保留原文供核对");
    return value;
  }).join("\n");
  return { markdown, warnings: [...new Set(warnings)] };
}

export function appendTranscriptionBlock(original: string, transcription: string, sourceUrl: string): string {
  return `${original.trimEnd()}\n\n> 手写转写（待核对）\n> 来源：${sourceUrl}\n\n${transcription.trim()}`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

// TipTap 通过 HTML 占位节点读取公式，保存时再由节点序列化回原始 Markdown。
export function mathMarkdownToEditorHtml(input: string): string {
  let inFence = false;
  return input.split("\n").map((line) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;
    return line.replace(/\$\$([^$]+)\$\$|(?<!\\)\$([^$\n]+)(?<!\\)\$/g, (_all, block: string | undefined, inline: string | undefined) => {
      const latex = block ?? inline ?? "";
      return `<span data-math data-latex="${escapeAttribute(latex)}" data-display="${block ? "true" : "false"}"></span>`;
    });
  }).join("\n");
}
