/**
 * Standalone trust/branding config for this app (design §2.2 "bank-onboarding"
 * — Bank of America-modelled business banking KYB relying party, design §5
 * scene 2 "onboard without re-submitting" + scene 4's reuse payoff).
 *
 * `apps/tour` (the KYB walkthrough shell) exists in this repo but does not
 * yet register a `bank-onboarding` entry in its own
 * `content/walkthrough.json` — following `apps/issuers`' own precedent
 * (`lib/branding.ts`), this module supplies the SAME shape (`BrandingConfig`
 * + `ThemeSpec`, both owned by `@jeswr/solid-showcase-kit`) directly, so the
 * whole trust surface (banner, footer, interstitial, metadata, theme)
 * behaves identically to a walkthrough-driven app. Once `apps/tour` absorbs
 * a `bank-onboarding` registry entry, swap this for `registeredApp` exactly
 * as `apps/vault` does for its own local `content/walkthrough.json` — nothing
 * else in this app should need to change.
 */
import type { BrandingConfig, ThemeSpec } from "@jeswr/solid-showcase-kit";

export const KYB_BRANDING: BrandingConfig = {
  convener: "EDMA Solid Community of Practice",
  description:
    "show how a bank could run its Customer Due Diligence (CDD) check by reading a business's already-issued organisational-identity and beneficial-ownership credentials straight from its own Data Vault pod, instead of re-collecting formation documents and cap tables at every new account",
  domainNegations: [
    "No real Customer Due Diligence decision is made here — every account-opening outcome is illustrative, and no real bank account is ever opened.",
    "No real business's data is read, no real LEI is verified against GLEIF's registry, and no real sanctions/adverse-media screening runs.",
  ],
  aboutHref: "/",
  consentCookiePrefix: "kyb-demo-consent-",
  bannedMarks: [
    {
      pattern: "\\bvLEI\\b",
      reason:
        "vLEI (KERI/ACDC) is GLEIF's own product; this demo reads W3C VC 2.0 credentials carrying LEI-shaped claims only, never a real vLEI credential.",
    },
    {
      pattern:
        "(?:bank\\s+of\\s+america)[\\s'’]+(?:logo|logos|seal|seals|wordmark|wordmarks|insignia|badge|badges|brandmark|brandmarks|trade\\s+dress)",
      reason:
        "Organisation logos, seals, and wordmarks must never render — organisations are named only in role-first 'modelled on' text.",
    },
  ],
};

export const BANK_ONBOARDING_APP = {
  appName: "Business Banking Onboarding",
  slug: "bank-onboarding",
  /** Design §2.2 row 4: Bank of America-modelled, folds in the Mastercard-modelled account-verification data flow. */
  modelledOn: "Bank of America",
  theme: {
    hue: 152,
    primary: "oklch(0.36 0.09 152)",
    accent: "oklch(0.72 0.1 152)",
    role: "business banking KYB/CDD relying party",
  } satisfies ThemeSpec,
  honesty: {
    real: [
      "Reads the business's org-identity, beneficial-ownership, and officer-authorization credentials over the real Solid protocol, authenticated as this app's OWN DPoP-bound service identity (@jeswr/solid-pod-guard's createServicePodFetch) against WAC access the business already granted",
      "Runs @kyb/vc-kit's real fail-closed verifyCredential chain on every credential — SHACL shape, validity window, Bitstring revocation status, and eddsa-rdfc-2022 signature, never a mock",
      "Verifies a REAL beneficial-ownership completeness ZK proof (Tier B, @kyb/vc-kit's verifyCompleteness) against the issuer-anchored kyb:beneficialOwnershipArrayCommitment read directly from the business's pod, plus a real per-owner threshold proof (Tier A, verifyOwnerThreshold) — a bank-minted single-use nonce, a genuine UltraHonk cryptographic verify, and the mandatory operand-anchor forgeability gate all run for real",
      "Declines the account when any credential fails to verify, the presented ZK proof is forged/tampered/replayed, or the proof's disclosed-owner count does not match what the beneficial-ownership credential actually discloses — never a silent pass",
    ],
    simulated: [
      "No real Customer Due Diligence decision is filed with any regulator, and no real bank account is opened.",
      "No real sanctions, adverse-media, or Mastercard-modelled account-verification API is called — this app's account-verification data flow is narrated, not live.",
      "The bank's own CDD decision record is computed and returned for display only in this build round; it is not yet persisted back into the business's pod (matching the vault's own documented scope for a bank-written record).",
    ],
  },
} as const;
