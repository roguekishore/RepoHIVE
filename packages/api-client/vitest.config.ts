import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@repohive/ui": path.resolve(__dirname, "../ui/src/index.ts"),
    },
  },
});
