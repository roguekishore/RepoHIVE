import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The `@/*` path alias from tsconfig.json, so tests can import route handlers.
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
