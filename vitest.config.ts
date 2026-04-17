import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/__integration__/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/test/**",
        "src/__integration__/**",
        "src/**/*.test.{ts,tsx}",
        "src/app/layout.tsx",
        "src/lib/i18n/request.ts",
      ],
      thresholds: {
        // Anti-regression floor. Set just below the current measured
        // coverage so any PR that adds untested code drops below the
        // floor and fails CI. RATCHET RULE: when a PR raises the
        // measured number by a meaningful margin, raise the matching
        // floor here in the same PR. Never lower a floor to make a
        // build pass. Target (per CLAUDE.md) is 90%+; we'll get there
        // by ratcheting, not by wishing.
        statements: 30,
        branches: 22,
        functions: 32,
        lines: 30,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
