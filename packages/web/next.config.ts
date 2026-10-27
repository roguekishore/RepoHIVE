import type { NextConfig } from "next";
import { APP_SECURITY_HEADERS } from "./src/security-headers";

/**
 * In development the API server runs on its own port. When `REPOHIVE_API_ORIGIN` is set, the dev server forwards the
 * API paths to it, so the browser still sees one origin and its cookies and `Origin` checks work. In production
 * Caddy does this routing and nothing here applies.
 */
const API_PATHS = ["/api/:path*", "/healthz", "/r/:path*", "/s/:path*"];

const nextConfig: NextConfig = {
  output: "standalone",
  // `@repohive/design` ships TypeScript source and CSS, so Next compiles it with the app.
  transpilePackages: ["@repohive/design"],
  async headers() {
    return [{ source: "/:path*", headers: [...APP_SECURITY_HEADERS] }];
  },
  async rewrites() {
    const apiOrigin = process.env.REPOHIVE_API_ORIGIN;
    if (apiOrigin === undefined || apiOrigin === "") return [];
    return API_PATHS.map((source) => ({ source, destination: `${apiOrigin}${source}` }));
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
