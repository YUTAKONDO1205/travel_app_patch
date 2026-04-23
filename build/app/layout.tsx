import { Noto_Sans_JP, Oswald } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const bodyFont = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-body-family",
  weight: ["400", "500", "700", "900"],
  display: "swap",
});

const numericFont = Oswald({
  subsets: ["latin"],
  variable: "--font-numeric-family",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Maison Passage Gateway Pair Explorer",
  description: "海外旅行の片道2枚と gateway 候補を静かに比較する、Maison Passage の航空路探索アプリ。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={`${bodyFont.variable} ${numericFont.variable}`}>{children}</body>
    </html>
  );
}
