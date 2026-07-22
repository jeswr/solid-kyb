/**
 * The MANDATORY ZK honesty-panel content (design §4/§8.1; decision 0005
 * posture carried over from the mortgage/lending showcases). EVERY ZK
 * surface renders these items - a ZK feature without the honesty panel must
 * not ship. Content is deliberately plain strings so apps can render it in
 * any component; tests pin the load-bearing phrases so copy drift is caught.
 */

import {
  PINNED_BB_JS_VERSION,
  PINNED_NARGO_VERSION,
  PINNED_NOIR_JS_VERSION,
} from "./circuits/registry.ts";

export interface HonestyItem {
  /** Stable identifier (UI keys, tests). */
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

/** The pinned proving toolchain. */
export const ZK_TOOLCHAIN = Object.freeze({
  noirJs: `@noir-lang/noir_js@${PINNED_NOIR_JS_VERSION}`,
  bbJs: `@aztec/bb.js@${PINNED_BB_JS_VERSION}`,
  nargo: `nargo ${PINNED_NARGO_VERSION}`,
  proofSystem: "Barretenberg UltraHonk (BN254, transparent - no trusted setup)",
  verifierTarget: "evm" as const,
});

/** The honesty items, in display order. */
export const ZK_HONESTY_ITEMS: readonly HonestyItem[] = Object.freeze([
  {
    id: "research-grade",
    title: "Research-grade cryptography, external audit pending",
    body:
      "The sparq zero-knowledge estate this demo builds on is research-grade: internally " +
      "re-audited but pending external cryptographer sign-off. This package's own Tier B " +
      "completeness circuit is bespoke, project-authored code (not a sparq-audited member) - " +
      "a passing proof here is a research demonstration, not a production cryptographic " +
      "guarantee.",
  },
  {
    id: "pre-decision-scope",
    title: "Zero-knowledge proof runs at the PRE-DECISION moment only",
    body:
      "This ZK rail proves exactly one thing to a shopping bank: that no undisclosed " +
      "beneficial owner holds >= 25% of the business - nothing else, and nothing is " +
      "disclosed. Once the bank proceeds toward an actual CDD record, Jordan grants full " +
      "VC access to the disclosed Organisational-Identity and Beneficial-Ownership " +
      "credentials, because CDD compliance needs the actual owner names and percentages on " +
      "file, not a proof. ZK never substitutes for the bank's CDD decisioning.",
  },
  {
    id: "tier-a-per-owner",
    title: "Tier A: live, in-browser per-owner threshold proof",
    body:
      "For each beneficial owner the business discloses as >= 25%, Tier A proves the hidden " +
      "ownershipPercentageBps value really is >= 2500 (25%), without revealing the exact " +
      "percentage, using the sparq filter_int_d4 circuit - the SAME committed circuit family " +
      "the mortgage and lending showcases use for their own threshold proofs.",
  },
  {
    id: "tier-b-completeness",
    title: "Tier B: a bespoke, project-authored completeness circuit",
    body:
      "The completeness statement - 'no UNDISCLOSED owner >= 25% exists' - needs a scan over " +
      "the full (hidden) owner array, which is not a member of the currently compiled sparq " +
      "circuit family available to this build. This package therefore ships its own circuit, " +
      "kyb_completeness_scan_n8, compiled with the identical pinned toolchain: it recomputes " +
      "a commitment over the hidden 8-slot owner array and asserts exactly the disclosed " +
      "count of slots meet the threshold. Unlike the mortgage/lending showcases' Tier B " +
      "(which needs native Poseidon2/Schnorr witness building and is therefore proved " +
      "offline and only verified live), this circuit's witness is cheap enough to prove " +
      "LIVE - a genuine improvement in freshness, at the cost of NOT composing sparq's own " +
      "hidden-issuer/revocation family into the same circuit (those checks run at the " +
      "ordinary credential-verification layer instead). Flagged for lead review as a " +
      "deliberate scope-down from the design's full scan+join+issuer+revocation manifest.",
  },
  {
    id: "digit-budget-leak",
    title: "Tier A's circuit choice leaks the value's digit count",
    body:
      "Tier A uses a fixed-width circuit member sized to the hidden value's own decimal " +
      "digit count (this demo's ownershipPercentageBps is always a 1-4 digit value), so a " +
      "verifier learns ceil(log10(value)) of the hidden percentage - e.g. that a stake has 4 " +
      "digits (10.00%-99.99%). This envelope leak is documented in the circuit source and is " +
      "inherent to the filter_int family.",
  },
  {
    id: "low-entropy-enumeration",
    title: "Low-entropy values can be narrowed by enumeration",
    body:
      "Tier A's operand encoding is deterministic and salt-free, so a determined verifier can " +
      "enumerate candidate basis-points values and compare encodings. The honest guarantee is " +
      "'not disclosed and not forgeable' - never 'cannot possibly be learned'. Identical " +
      "values also produce identical encodings across issuers (linkability).",
  },
  {
    id: "toolchain-pins",
    title: "The toolchain is pinned - versions matter",
    body:
      `Proving and verifying run ${ZK_TOOLCHAIN.noirJs} + ${ZK_TOOLCHAIN.bbJs} over ` +
      `circuits compiled with ${ZK_TOOLCHAIN.nargo} (${ZK_TOOLCHAIN.proofSystem}). ` +
      "Public-input byte layout can change across bb.js nightlies, so every component pins " +
      "exact versions; proofs use the 'evm' flavour, which stays fully zero-knowledge - the " +
      "*-no-zk flavours are rejected outright.",
  },
  {
    id: "operand-anchor-binding",
    title: "Every live proof is bound to an issuer-signed operand anchor",
    body:
      "A live threshold or completeness proof alone is forgeable: anyone can compute the " +
      "encoding/commitment of any value and prove a true statement about it. Every live " +
      "proof is therefore checked against an issuer-signed kyb:ZkOperandAnchor credential - " +
      "the verifier requires the anchor's signature, its revocation status, its subject (the " +
      "presenter's WebID), its field, and the exact equality of its anchored encoding with " +
      "the proof's public input, plus a single-use challenge minted for this session. If any " +
      "check fails, the proof is rejected.",
  },
]);

/** The full panel payload apps feed into a HonestyPanel-style component. */
export const ZK_HONESTY = Object.freeze({
  headline:
    "Real zero-knowledge cryptography with honestly-stated limits: research-grade, " +
    "externally unaudited, scoped to the pre-decision moment only, and leakier than " +
    "production ZK systems would be. Tier B is this package's own bespoke circuit, not a " +
    "sparq-audited family member.",
  items: ZK_HONESTY_ITEMS,
  toolchain: ZK_TOOLCHAIN,
  /**
   * Multithreaded proving needs cross-origin isolation: apps set COOP
   * (`same-origin`) + COEP (`require-corp`) response headers; without them
   * proving still works, single-threaded (~4x slower).
   */
  coopCoep: "COOP: same-origin + COEP: require-corp enable multithreaded proving",
});
