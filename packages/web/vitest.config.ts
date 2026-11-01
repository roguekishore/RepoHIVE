import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The `@/*` path alias from tsconfig.json.
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["src/proxy.test.ts", "src/features/host/translation-contract.test.ts"],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: "client",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/test-setup.ts"],
          include: ["src/{components,features,lib,styles}/**/*.test.{ts,tsx}"],
          exclude: ["src/features/host/translation-contract.test.ts"],
        },
      },
    ],
  },
});
