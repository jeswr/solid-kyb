import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
