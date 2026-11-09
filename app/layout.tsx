import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import AmbientBackground, { AmbientProvider } from "@/components/AmbientBackground";
import { ThemeProvider, THEME_STORAGE_KEY } from "@/components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Offscript — practice thinking out loud",
  description:
    "Get a topic, talk for two minutes, and get AI feedback on your content and delivery. No account, no database.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e8eee7" },
    { media: "(prefers-color-scheme: dark)", color: "#08090b" },
  ],
};

const themeInitScript = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'){document.documentElement.classList.add('light');document.documentElement.setAttribute('data-theme','light');document.documentElement.style.colorScheme='light';}else{document.documentElement.classList.remove('light');document.documentElement.setAttribute('data-theme','dark');document.documentElement.style.colorScheme='dark';}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-base font-sans text-[15px] leading-relaxed text-foreground relative">
        <ThemeProvider>
          <AmbientProvider>
            <AmbientBackground />
            <div className="relative z-10">{children}</div>
          </AmbientProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
