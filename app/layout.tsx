import type { Metadata } from "next";
import "./globals.css";
import "./v2.css";

export const metadata: Metadata = {
  title: "栖流 Flowhome · 城市生活实验室",
  description: "家与流动共生：探索城市供需计算、个人生活决策与共益运营。",
  other: {
    "codex-preview": "development",
  },
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
