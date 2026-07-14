import { Noto_Sans_JP, Plus_Jakarta_Sans } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./skins/base.css";
import "./skins/skeuo.css";
import "./skins/neo.css";
import "./skins/glass.css";
import "./skins/clay.css";
import "./skins/minimal.css";
import "./skins/maximal.css";
import "./skins/brutal.css";
import "./skins/liquid.css";
import "./skins/bento.css";
import "./skins/spatial.css";

const bodyFont = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-body-family",
  weight: ["400", "500", "700", "900"],
  display: "swap",
});

const latinFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-latin-family",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Maison Passage｜片道2枚で海外航空券を比較",
  description:
    "海外の航空券を、往復ではなく片道2枚で比べるツール。月をまたいだ往路と、滞在日数ぶん後の復路を比べて、安い入口と出口を探します。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={`${bodyFont.variable} ${latinFont.variable}`}>{children}</body>
    </html>
  );
}
