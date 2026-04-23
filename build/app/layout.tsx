import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Maison Passage Open Jaw Explorer",
  description:
    "海外旅行の入口と出口を静かに比較する、Maison Passage の open jaw 航空路探索アプリ。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
