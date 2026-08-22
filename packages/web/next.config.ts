import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@repohive/ui", "@repohive/types", "@repohive/api-client"],
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
  },
  // The workspace packages (@repohive/types, @repohive/ui,
  // @repohive/api-client) are ESM
  // ("type": "module") and their barrel files re-export with explicit ".js"
  // specifiers (e.g. export * from "./graph.js") that point at ".ts" sources.
  // Webpack needs an extension alias to map those ".js" specifiers back to the
  // real ".ts"/".tsx" files when it transpiles these packages inline; without
  // it, any value import of a barrel entry fails to resolve at build time.
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
