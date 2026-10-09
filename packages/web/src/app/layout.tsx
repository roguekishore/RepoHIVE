import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { Host_Grotesk } from "next/font/google";
import { themeInitScript } from "@repohive/design";
import "./reset.css";
import "@repohive/design/styles.css";

// The face of the identity (`@repohive/design`; its tokens.css reads `--font-host-grotesk`). The mono face is Geist
// Mono from the `geist` package, which sets `--font-geist-mono`.
const hostGrotesk = Host_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-host-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "RepoHIVE",
    template: "%s - RepoHIVE",
  },
  description:
    "Hierarchical codebase indexing with recorded per-region preserve/reconstruct decisions",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistMono.variable} ${hostGrotesk.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
