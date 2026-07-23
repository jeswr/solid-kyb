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
  //
  // `@aztec/bb.js` + `@noir-lang/noir_js` (this app's ONLY consumers of
  // `@kyb/vc-kit`'s ZK submodule — the `/api/kyb/challenge`+`/api/kyb/
  // decision` beneficial-ownership completeness proof verify) ALSO need to
  // stay external: `@kyb/vc-kit` is externalized above, but Turbopack still
  // bundled ITS transitive WASM deps under `next build`/`next start` before
  // this line existed — confirmed empirically (`e2e/journey.spec.ts`, real
  // cross-zone journey): a genuinely valid UltraHonk proof, generated fine
  // and passing every earlier gate (structural/nonce/challenge/anchor), came
  // back `PROOF_INVALID` from THIS bundled server every time, while the
  // exact same proof bytes verified `true` via a plain `node` script loading
  // the same `@kyb/vc-kit` from the same `node_modules` — i.e. a genuine
  // Turbopack WASM-bundling corruption, not a cryptography or protocol bug.
  // Adding both here (no other behaviour change) fixed it.
  serverExternalPackages: ["@kyb/vc-kit", "@aztec/bb.js", "@noir-lang/noir_js"],
};

export default nextConfig;
