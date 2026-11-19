import type { Metadata, Viewport } from "next";
import { Kanit, Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

const thai = Noto_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "500", "600", "700"], variable: "--thai" });
const kanit = Kanit({ subsets: ["thai", "latin"], weight: ["700"], variable: "--kanit" });

export const metadata: Metadata = {
  title: "Reels Autopilot",
  description: "ผลิตและโพสต์ Facebook Reels อัตโนมัติ",
  appleWebApp: { capable: true, title: "Reels Autopilot", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${thai.variable} ${kanit.variable}`}>
      <body>{children}</body>
    </html>
  );
}
