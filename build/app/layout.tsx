import { Cormorant_Garamond, Noto_Sans_JP } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const displayFont = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-display-family",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const bodyFont = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-body-family",
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Maison Passage Open Jaw Explorer",
  description: "海外旅行の入口と出口を静かに比較する、Maison Passage の open jaw 航空路探索アプリ。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={`${displayFont.variable} ${bodyFont.variable}`}>{children}</body>
    </html>
  );
}
