import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Genuine UltraHonk proving (WASM, single-threaded in Node) is expensive —
    // mirrors @kyb/vc-kit's own PROVE_TIMEOUT-scale budget for its ZK suites.
    testTimeout: 180_000,
    hookTimeout: 120_000,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
