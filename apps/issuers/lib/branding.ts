/**
 * Standalone trust/branding config for this app (design §2.2 "issuers" —
 * GLEIF-modelled org-identity + officer-authorization flows, plus an
 * unbranded registry/FinCEN-BO-source-modelled beneficial-ownership flow).
 *
 * `apps/tour` (the KYB walkthrough shell, `@kyb/app-tour`) does not exist yet
 * in this repo (AGENTS.md: "No apps exist yet" at the time this app was
 * built) — the lending/mortgage showcases' pattern of importing
 * `@lending/app-tour/content/walkthrough.json` isn't available here. This
 * module supplies the SAME shape (`BrandingConfig` + `ThemeSpec`, both owned
 * by `@jeswr/solid-showcase-kit`) directly, so the whole trust surface
 * (banner, footer, interstitial, metadata, theme) is real and behaves
 * identically to a walkthrough-driven app. Once `apps/tour` lands, swap
 * `KYB_BRANDING`/`ISSUERS_APP` for the registry's `branding`/`registeredApp`
 * exactly as `apps/verifications` does in the sibling `jeswr/solid-lending`
 * repo — nothing else in this app should need to change.
 */
import type { BrandingConfig, ThemeSpec } from "@jeswr/solid-showcase-kit";

export const KYB_BRANDING: BrandingConfig = {
  convener: "EDMA Solid Community of Practice",
  description:
    "show how a business's organisational-identity and beneficial-ownership proof could be issued once and reused across every bank and counterparty that needs KYB",
  domainNegations: [
    "Nothing here is a real LEI issuance, a real GLEIF vLEI credential, or a real business registry filing.",
    "No real Customer Due Diligence decision is made, no real beneficial-ownership registry is queried, and no real business's data is used.",
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
        "(?:gleif)[\\s'’]+(?:logo|logos|seal|seals|wordmark|wordmarks|insignia|badge|badges|brandmark|brandmarks|trade\\s+dress)",
      reason:
        "Organisation logos, seals, and wordmarks must never render — organisations are named only in role-first 'modelled on' text.",
    },
  ],
};

export const ISSUERS_APP = {
  appName: "Formation & Identity Registrar",
  slug: "issuers",
  /** Design §2.2: two GLEIF-modelled flows + one unbranded-registry-modelled flow. */
  modelledOn: "GLEIF and an unbranded business registry / FinCEN BO data source",
  theme: {
    hue: 231,
    primary: "oklch(0.42 0.1 231)",
    accent: "oklch(0.74 0.09 231)",
    role: "organisational-identity, beneficial-ownership, and officer-authorization credential issuer",
  } satisfies ThemeSpec,
  honesty: {
    real: [
      "Issues real W3C VC 2.0 credentials (eddsa-rdfc-2022 Data Integrity proofs) into the authenticated business's Data Vault pod over the Solid protocol, SHACL-validated before signing",
      "Mints a real kyb:ZkOperandAnchor over the beneficial-ownership array commitment (Blake3, computed in-process) beside the Beneficial-Ownership Credential",
      "Serves an authenticated pod route guarded by @jeswr/solid-pod-guard (fails closed until an operator configures it)",
    ],
    simulated: [
      "Every LEI is an obviously-illustrative, checksum-valid, never-GLEIF-accredited placeholder — no real LEI issuance and no real GLEIF vLEI (KERI/ACDC)",
      "Organisational-identity, beneficial-ownership, and officer-authorization credentials are issued from scripted demo data (Northwind Logistics LLC) — no real business registry or FinCEN BO-source query is made",
      "Per-owner ZK operand anchors (kyb:ownershipPercentageBps) require the sparq native encoding bridge (SPARQ_CHECKOUT); without a local sparq checkout this rail honestly reports them as not minted rather than fabricating an encoding",
    ],
  },
} as const;
