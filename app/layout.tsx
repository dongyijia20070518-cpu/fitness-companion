import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "向好 · Wellward",
  description: "真实记录、跨设备同步的温柔科学健身减脂管理工具。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
