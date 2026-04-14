import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/__integration__/**/*.test.ts"],
    setupFiles: ["./src/__integration__/setup.ts"],
    globalSetup: ["./src/__integration__/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
    reporters: ["default"],
    coverage: { enabled: false },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
