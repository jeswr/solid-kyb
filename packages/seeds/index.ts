/**
 * `@kyb/seeds` — the deterministic Northwind Logistics LLC persona pod seeder (design §5
 * scene 1 / §7): three REAL signed KYB credentials (Organisational-Identity,
 * Beneficial-Ownership, Officer-Authorization) genuinely issued through `@kyb/vc-kit`, the
 * Tier B beneficial-ownership completeness anchor (always real), the Tier A per-owner
 * threshold anchors (real when `SPARQ_CHECKOUT` is available, honestly skipped otherwise),
 * laid out with least-privilege owner-only access through `@jeswr/solid-seed`.
 */
export {
  ANCHOR_POD_PATHS,
  anchorValidity,
  CREDENTIAL_POD_PATHS,
  ISSUER_ROLES,
  type KybSeedIssuerRole,
  northwindLogistics,
  type ScriptedCredentialSeed,
  scriptedCredentialSeeds,
} from "./credentials.ts";
export {
  createKybIssuance,
  type CreateKybIssuanceOptions,
  type KybCredentialIssuance,
  type KybIssuanceContext,
  type SeededAnchorResource,
  type SeedResourceBody,
  tierANativeBridgeAvailable,
  type TierAAnchorOutcome,
  type TierBAnchorOutcome,
} from "./issuance.ts";
export { seedKybPod, type SeedKybPodOptions, type SeededKybPod } from "./kyb-pod.ts";
export { normalizedPodBase } from "./pod-base.ts";
