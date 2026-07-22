import type { NextConfig } from "next";

/**
 * Zone app: served under the (future) shell's rewrite prefix, so the basePath
 * matches this app's registry `path` (design §2.2: slug "bank-onboarding",
 * path "/bank-onboarding") once `apps/tour` absorbs this app's registry entry.
 */
const nextConfig: NextConfig = {
  basePath: "/bank-onboarding",
  // `@kyb/vc-kit`'s seed-tooling native bridge (`seed-tooling/native.ts`)
  // locates its helper directory via `new URL("../../scripts/sparq-helper",
  // import.meta.url)` — a Node-only, `SPARQ_CHECKOUT`-gated code path that
  // Turbopack/webpack cannot statically bundle (there is no built asset to
  // resolve at build time). Keep `@kyb/vc-kit` external so it is `require`d
  // at runtime on the server instead of bundled — same posture `apps/issuers`
  // and `apps/vault` already take.
  serverExternalPackages: ["@kyb/vc-kit"],
};

export default nextConfig;
