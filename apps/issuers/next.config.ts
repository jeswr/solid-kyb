import type { NextConfig } from "next";

/**
 * Zone app: served under the (future) shell's rewrite prefix, so the basePath
 * matches this app's registry `path` once `apps/tour/content/walkthrough.json`
 * exists (design §2.2: slug "issuers", path "/issuers").
 */
const nextConfig: NextConfig = {
  basePath: "/issuers",
  // `@kyb/vc-kit`'s seed-tooling native bridge (`seed-tooling/native.ts`)
  // locates its helper directory via `new URL("../../scripts/sparq-helper",
  // import.meta.url)` — a Node-only, `SPARQ_CHECKOUT`-gated code path that
  // Turbopack/webpack cannot statically bundle (there is no built asset to
  // resolve at build time). Keep `@kyb/vc-kit` external so it is `require`d
  // at runtime on the server instead of bundled.
  serverExternalPackages: ["@kyb/vc-kit"],
};

export default nextConfig;
