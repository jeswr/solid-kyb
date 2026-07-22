import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Real bb.js UltraHonk proving/verifying is slow cold (WASM instantiate +
    // genuine cryptography) — a generous timeout, not a sign of a hang.
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
