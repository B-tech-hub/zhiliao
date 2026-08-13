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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning：next-themes 的防闪烁脚本会在水合前改写 html 的 class
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <ThemeProvider>{children}</ThemeProvider>
        <SwRegister />
      </body>
    </html>
  );
}
