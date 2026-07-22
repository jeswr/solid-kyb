/**
 * Standalone trust/branding config for this app (design §2.2 "bank-credit" —
 * Fifth-Third-modelled, the SECOND relying party in the journey; design §5
 * scenes 3-4: "prove ownership without exposing the cap table" / "reuse, not
 * re-collection"). `apps/tour` does not exist in this repo yet — same
 * standalone-branding posture `apps/issuers` already established (see that
 * app's `lib/branding.ts` header): this module supplies the same shape
 * (`BrandingConfig` + `ThemeSpec`, both owned by `@jeswr/solid-showcase-kit`)
 * directly, so the trust surface (banner, footer, interstitial, metadata,
 * theme) is real and behaves identically to a walkthrough-driven app.
 */
import type { BrandingConfig, ThemeSpec } from "@jeswr/solid-showcase-kit";

export const KYB_BRANDING: BrandingConfig = {
  convener: "EDMA Solid Community of Practice",
  description:
    "show how a business's organisational-identity and beneficial-ownership proof could be issued once and reused across every bank and counterparty that needs KYB",
  domainNegations: [
    "Nothing here is a real LEI issuance, a real GLEIF vLEI credential, or a real business registry filing.",
    "No real Customer Due Diligence decision is made, no real credit line is extended, and no real business's data is used.",
  ],
  aboutHref: "/",
  consentCookiePrefix: "kyb-demo-consent-",
  bannedMarks: [
    {
      pattern: "\\bvLEI\\b",
      reason:
        "vLEI (KERI/ACDC) is GLEIF's own product; this demo issues W3C VC 2.0 credentials carrying LEI-shaped claims only, never a real vLEI credential.",
    },
    {
      pattern:
        "(?:fifth\\s*third)[\\s'’]+(?:logo|logos|seal|seals|wordmark|wordmarks|insignia|badge|badges|brandmark|brandmarks|trade\\s+dress)",
      reason:
        "Organisation logos, seals, and wordmarks must never render — organisations are named only in role-first 'modelled on' text.",
    },
  ],
};

export const BANK_CREDIT_APP = {
  appName: "Business Credit Desk",
  slug: "bank-credit",
  /** Design §2.2: the SECOND, competing relying party — a business line of credit desk. */
  modelledOn: "Fifth Third Bank",
  theme: {
    hue: 152,
    primary: "oklch(0.32 0.09 152)",
    accent: "oklch(0.73 0.1 152)",
    role: "business line-of-credit desk — the second bank reusing the same KYB credentials",
  } satisfies ThemeSpec,
  honesty: {
    real: [
      "Reads the SAME organisational-identity and beneficial-ownership credentials the `issuers` app signed into Northwind's Data Vault pod, over an authenticated Solid read against this app's own service identity — no document is re-collected, re-uploaded, or re-typed",
      "Runs the REAL fail-closed @kyb/vc-kit verifyCredential chain on both credentials (signature, issuer trust, validity window, Bitstring status, SHACL shape) before any decision is made",
      "Writes a real, SHACL-validated kyb:CddDecisionRecord back into the business's pod, at a path scoped to this bank alone, naming the exact credential versions checked",
      'Serves an authenticated pod route guarded by @jeswr/solid-pod-guard (fails closed until an operator configures it) — a non-granted or revoked service identity is denied by the pod\'s own WAC, never silently treated as "no data"',
    ],
    simulated: [
      "No real business line of credit is extended and no real underwriting system is consulted — the decision is a deterministic, illustrative rule over the verified credential claims only",
      "Every LEI is an obviously-illustrative, checksum-valid, never-GLEIF-accredited placeholder",
      "The scene-3 ZK beneficial-ownership completeness proof (design §4) is this app's design-routed pre-decision check; it is not wired into this build — the disclosed-credential reuse path is the demo's real, load-bearing surface this round",
    ],
  },
} as const;
