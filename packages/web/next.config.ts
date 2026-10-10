import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * The web app is a static export (`output: "export"`): `next build` writes
 * `out/`, which a host serves. Security headers are the server's and Caddy's
 * job, so there is no `headers()` here.
 *
 * Repository and job pages are client shells exported once under the
 * placeholder params `_`. A production host maps the real paths onto those
 * files (see "Static export and host mapping" in README.md). `next dev` has no
 * such host, so in development only the same mapping is done with rewrites,
 * together with the proxy to the Java server. The export build never sees them.
 */
const apiOrigin = process.env.REPOHIVE_API_ORIGIN ?? "http://127.0.0.1:8080";

export default function config(phase: string): NextConfig {
  const base: NextConfig = {
    output: "export",
    experimental: {
      optimizePackageImports: ["lucide-react"],
    },
    images: {
      unoptimized: true,
    },
  };

  if (phase !== PHASE_DEVELOPMENT_SERVER) {
    return base;
  }

  // `next dev` checks every requested path against `generateStaticParams` when
  // `output: "export"` is set, and cannot see the placeholders a layout exports.
  // The rewrites below send every real path to the placeholder route anyway, so
  // development runs without `output`; only the production build is exported.
  const { output: _output, ...development } = base;
  return {
    ...development,
    async rewrites() {
      return {
        beforeFiles: [
          { source: "/api/:path*", destination: `${apiOrigin}/api/:path*` },
          { source: "/artifacts/:path*", destination: `${apiOrigin}/artifacts/:path*` },
          { source: "/healthz", destination: `${apiOrigin}/healthz` },
          { source: "/repos/:owner/:repo", destination: "/repos/_/_" },
          { source: "/repos/:owner/:repo/:surface", destination: "/repos/_/_/:surface" },
          { source: "/jobs/:jobId", destination: "/jobs/_" },
        ],
        afterFiles: [],
        fallback: [],
      };
    },
  };
}
