import type { NextConfig } from "next";

/**
 * Workspace packages the server loads from node_modules at run time instead of
 * bundling. The indexer (hosting-2) and the engine under it are compiled ESM
 * that use `import.meta.resolve`, which webpack cannot bundle. Next.js's
 * `serverExternalPackages` does not apply to them: npm links workspace
 * packages, so they resolve outside node_modules and Next.js bundles them
 * anyway. A webpack external of type `import` leaves a plain dynamic import.
 */
const SERVER_RUNTIME_PACKAGES = new Set(["@repohive/indexer", "@repohive/engine"]);

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
  webpack(config, { isServer }) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".jsx"],
    };
    if (isServer) {
      const runtimeExternal = (
        { request }: { request?: string },
        callback: (error?: Error | null, result?: string) => void,
      ) => {
        if (request !== undefined && SERVER_RUNTIME_PACKAGES.has(request)) {
          callback(null, `import ${request}`);
          return;
        }
        callback();
      };
      config.externals = [runtimeExternal, ...(Array.isArray(config.externals) ? config.externals : [config.externals])];
    }
    return config;
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
