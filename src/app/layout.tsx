import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "知了",
  description: "知了：主题导向的个人知识库，随手记，AI 替你归档",
  // iOS 添加到主屏幕：独立窗口 + 桌面图标（PWA 方案见 docs/adr/0006）
  appleWebApp: { capable: true, title: "知了", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // 不在此声明 themeColor：它会产生 React 管理的 meta 节点，与 ThemeColorSync 的
  // 客户端接管互相冲突（见 theme-provider.tsx 注释）；首帧状态栏色由 manifest theme_color 兜底
};

/* 侧栏折叠偏好必须在首帧前落到 <html>：服务端读不到 localStorage，只能先渲染展开态，
   若等水合后再收起，居中的正文会横向跳 200px。与 next-themes 的防闪烁脚本同一路数，
   故同样是一段同步阻塞脚本，且必须排在 <body> 的第一位（侧栏 DOM 在其之后才解析）。
   写坏一次的代价只是侧栏形态错，所以整段用 try/catch 兜住——无痕模式下读 localStorage 会抛。 */
const NAV_COLLAPSE_SCRIPT =
  'try{if(localStorage.getItem("zhiliao.navCollapsed")==="1")document.documentElement.dataset.navCollapsed="1"}catch(e){}';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning：next-themes 的防闪烁脚本会在水合前改写 html 的 class
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <script dangerouslySetInnerHTML={{ __html: NAV_COLLAPSE_SCRIPT }} />
        <ThemeProvider>{children}</ThemeProvider>
        <SwRegister />
      </body>
    </html>
  );
}
