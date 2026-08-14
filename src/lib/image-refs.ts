// 笔记正文中本地图片引用的统一提取口径：同时覆盖 Markdown ![alt](/api/images/x)
// 与内嵌 HTML <img src="/api/images/x">（图片属性内嵌 HTML 的决策见 ADR 0002）。
// 导出改写、孤儿图片判定、AI 读图都依赖此正则，改动前先确认三处语义一致。
const IMAGE_REF_RE = /\/api\/images\/([\w.-]+)/g;

export function extractImageFilenames(content: string): string[] {
  return [...content.matchAll(IMAGE_REF_RE)].map((m) => m[1]);
}
