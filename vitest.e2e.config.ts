import { defineConfig } from "vitest/config";
import path from "path";

// E2E suite: spawns the real ingestion worker against a local resource server
// and an in-memory fake of the Convex HTTP API. Node environment, slow tests.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 120_000,
    include: ["e2e/**/*.e2e.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
