import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./__tests__/setup.ts"],
    include: ["__tests__/**/*.{test,spec}.{ts,tsx}", "src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist"],
  },
  resolve: {
    // Subpath aliases MUST precede the bare "@repohive/types" entry:
    // @rollup/plugin-alias matches the first entry whose `find` prefixes the
    // import (`importee === find || importee.startsWith(find + "/")`), so a
    // leading bare alias shadows every `/subpath` and rewrites e.g.
    // `@repohive/types/health` → `<…/index.ts>/health`. That only breaks
    // runtime *value* imports (type-only imports are erased), which is why it
    // stayed latent until a test transitively value-imported a types subpath.
    // Keep this list in sync with packages/types/package.json `exports`.
    alias: {
      "@repohive/types/graph": path.resolve(__dirname, "../types/src/graph.ts"),
      "@repohive/types/git": path.resolve(__dirname, "../types/src/git.ts"),
      "@repohive/types/docs": path.resolve(__dirname, "../types/src/docs.ts"),
      "@repohive/types/decisions": path.resolve(__dirname, "../types/src/decisions.ts"),
      "@repohive/types/dead-code": path.resolve(__dirname, "../types/src/dead-code.ts"),
      "@repohive/types/symbols": path.resolve(__dirname, "../types/src/symbols.ts"),
      "@repohive/types/chat": path.resolve(__dirname, "../types/src/chat.ts"),
      "@repohive/types/workspace": path.resolve(__dirname, "../types/src/workspace.ts"),
      "@repohive/types/blast-radius": path.resolve(__dirname, "../types/src/blast-radius.ts"),
      "@repohive/types/jobs": path.resolve(__dirname, "../types/src/jobs.ts"),
      "@repohive/types/settings": path.resolve(__dirname, "../types/src/settings.ts"),
      "@repohive/types/security": path.resolve(__dirname, "../types/src/security.ts"),
      "@repohive/types/owners": path.resolve(__dirname, "../types/src/owners.ts"),
      "@repohive/types/modules": path.resolve(__dirname, "../types/src/modules.ts"),
      "@repohive/types/overview": path.resolve(__dirname, "../types/src/overview.ts"),
      "@repohive/types/files": path.resolve(__dirname, "../types/src/files.ts"),
      "@repohive/types/external-systems": path.resolve(
        __dirname,
        "../types/src/external-systems.ts",
      ),
      "@repohive/types/health": path.resolve(__dirname, "../types/src/health.ts"),
      "@repohive/types/coupling": path.resolve(__dirname, "../types/src/coupling.ts"),
      "@repohive/types/stats": path.resolve(__dirname, "../types/src/stats.ts"),
      "@repohive/types": path.resolve(__dirname, "../types/src/index.ts"),
    },
  },
});
