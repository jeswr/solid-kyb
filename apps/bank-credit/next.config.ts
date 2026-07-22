import type { NextConfig } from "next";

/**
 * Zone app: served under the (future) shell's rewrite prefix, matching this
 * app's design §2.2 registry slug "bank-credit". Modelled on Fifth Third
 * Bank — the SECOND relying party in the KYB journey (design §5 scenes 3/4):
 * a competing bank that opens a business line of credit by REUSING the same
 * org-identity + beneficial-ownership credentials the `issuers` app already
 * signed into Northwind's Data Vault, with zero re-collection.
 */
const nextConfig: NextConfig = {
  basePath: "/bank-credit",
  // `@kyb/vc-kit`'s seed-tooling native bridge is Node-only and cannot be
  // statically bundled by Turbopack/webpack (same reason `issuers` keeps it
  // external) — this app never touches that bridge, but the package's entry
  // point still resolves it, so keep it external for the same reason.
  serverExternalPackages: ["@kyb/vc-kit"],
};

export default nextConfig;
