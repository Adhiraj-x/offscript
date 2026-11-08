import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Offscript — practice thinking out loud",
  description:
    "Get a topic, talk for two minutes, and get AI feedback on your content and delivery. No account, no database.",
};

export const viewport: Viewport = {
  themeColor: "#08090b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-base font-sans text-[15px] leading-relaxed text-white">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
