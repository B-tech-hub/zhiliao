import type { MetadataRoute } from "next";

// PWA 清单（Next 约定式，服务于 /manifest.webmanifest）。
// 注意：该文件被 middleware 免登录放行——浏览器抓取 manifest 不携带 cookie
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "知了",
    short_name: "知了",
    description: "知了：主题导向的个人知识库，随手记，AI 替你归档",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // 启动闪屏底色只能写静态值，设计门禁对此处做精确例外；运行时状态栏色由 meta theme-color 接管。
    background_color: "#f5f5f7",
    theme_color: "#f5f5f7",
    lang: "zh-CN",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
