import { defineConfig } from "@playwright/test";

/**
 * The KYB cross-app journey suite (`journey.spec.ts`) boots its own pods +
 * apps entirely inside `beforeAll` (no shared `globalSetup` pod — every
 * resource this suite reads is seeded by the suite itself in its own
 * isolated run). No `webServer` either: every zone app is booted by
 * `support/app-runner.ts`'s `AppRunner` on a dynamically-assigned loopback
 * port, and every navigation in `journey.spec.ts` targets that app's own
 * origin directly.
 *
 * Browsers: `pnpm exec playwright install` once before `pnpm e2e`.
 */
export default defineConfig({
  testDir: ".",
  // Six real `next`-server cold starts (one dev, four production) plus real
  // DPoP/UltraHonk-ZK round trips comfortably exceed the 5s default.
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
  },
});
