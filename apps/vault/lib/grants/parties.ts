/**
 * The vault's grantable parties (design §6.1/§6.2, adapted from the small-dollar-lending
 * showcase's wallet — read-only reference — to this demo's KYB relying parties) and, per
 * party, exactly which credentials it may be granted. Party WebIDs are OPERATOR-PINNED env
 * config — never request-supplied (decision-0015-style rail, carried over unchanged).
 *
 * Scene mapping:
 *  - `bank-onboarding` (Bank of America-modelled): the full KYB/CDD relying party — reads
 *    the org-identity and beneficial-ownership credentials directly (disclosed; CDD needs
 *    actual values, not a proof), plus the officer-authorization credential to identify the
 *    control person/authorized signer opening the account (design §5 scene 2).
 *  - `bank-credit` (Fifth Third-modelled): screens the credit-line application against the
 *    ZK proofs first (design §5 scene 3); once it proceeds, it is granted the SAME three
 *    credentials for the actual CDD record (design §5 scene 3's closing beat) — this is the
 *    scene-4 "reuse, not re-collection" payoff: both banks' grants scope to the same
 *    underlying credentials, never a third copy.
 */
import type { ResourceId } from "./resources";

export const GRANT_PARTY_IDS = ["bank-onboarding", "bank-credit"] as const;

export type GrantPartyId = (typeof GRANT_PARTY_IDS)[number];

export function isGrantPartyId(value: string): value is GrantPartyId {
  return (GRANT_PARTY_IDS as readonly string[]).includes(value);
}

export interface GrantPartyDefinition {
  readonly id: GrantPartyId;
  /** Role-first display label (never "by {Org}") — mirrors the tour registry copy. */
  readonly label: string;
  /** The env var naming this party's service WebID (operator-pinned). */
  readonly envVar: string;
  /** The credentials this party may be granted (read-only in this demo). */
  readonly resources: readonly ResourceId[];
}

export const GRANT_PARTIES: Readonly<Record<GrantPartyId, GrantPartyDefinition>> = {
  "bank-onboarding": {
    id: "bank-onboarding",
    label: "Business banking KYB relying party — modelled on Bank of America",
    envVar: "KYB_BANK_ONBOARDING_SERVICE_WEBID",
    resources: ["orgIdentity", "beneficialOwnership", "officerAuthorization"],
  },
  "bank-credit": {
    id: "bank-credit",
    label: "Business credit desk — modelled on Fifth Third Bank",
    envVar: "KYB_BANK_CREDIT_SERVICE_WEBID",
    resources: ["orgIdentity", "beneficialOwnership", "officerAuthorization"],
  },
};

/** Whether `party` may ever be granted `resource` (the catalogue is closed — a grant for
 * an off-catalogue pair is refused before any pod IO). */
export function partyMayBeGranted(party: GrantPartyId, resource: ResourceId): boolean {
  return GRANT_PARTIES[party].resources.includes(resource);
}
