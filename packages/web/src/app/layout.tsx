import type { Metadata } from "next";
import { Suspense } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Host_Grotesk, Lora } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { AppShell } from "@/components/layout/app-shell";
import { SWRProvider } from "@/components/layout/swr-provider";
import "@/styles/globals.css";

// Serif display face for the docs/wiki reading surfaces (--font-serif token).
const lora = Lora({ subsets: ["latin"], variable: "--font-lora", display: "swap" });

// The face of the new identity (`@repohive/design`; its tokens.css reads `--font-host-grotesk`). The mono face is Geist
// Mono from the `geist` package above, which sets `--font-geist-mono`.
const hostGrotesk = Host_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-host-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "RepoHIVE",
    template: "%s — RepoHIVE",
  },
  description:
    "Hierarchical codebase indexing with recorded per-region preserve/reconstruct decisions",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} ${lora.variable} ${hostGrotesk.variable}`}
    >
      <body className="bg-[var(--color-bg-root)] text-[var(--color-text-primary)] antialiased">
        <ThemeProvider>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-[var(--color-bg-elevated)] focus:px-3 focus:py-2 focus:text-sm focus:text-[var(--color-text-primary)] focus:outline focus:outline-2 focus:outline-[var(--color-accent-primary)]"
          >
            Skip to content
          </a>
          <NuqsAdapter>
            <SWRProvider>
              <TooltipProvider delayDuration={300}>
                <Suspense fallback={null}>
                  <AppShell>{children}</AppShell>
                </Suspense>
              </TooltipProvider>
            </SWRProvider>
          </NuqsAdapter>
        </ThemeProvider>
      </body>
    </html>
  );
}
