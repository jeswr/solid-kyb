/**
 * The SCRIPTED-CREDENTIAL layer of the KYB seeder: the ONE source of Northwind Logistics
 * LLC's pinned demo credential inputs (design §7) — pod paths, issuer roles, claim values —
 * so every consumption point (the seeder integration suite, and any later dev-pod/e2e
 * caller) can never drift from `@kyb/data-model`'s own persona fixture.
 *
 * Value provenance: `PERSONA_VALUES[0]` (Northwind Logistics LLC / Jordan Blake 42%, Priya
 * Nandakumar 28%, Marcus Webb 18%, Dana Reyes 12% — `packages/data-model/src/personas.ts`,
 * design §7). Pod paths for the three signed credentials reuse `RESOURCE_POD_PATHS` from
 * `@kyb/data-model` verbatim, so any app reading that constant finds the SAME resource this
 * seeder writes.
 *
 * Node-only by convention (this module itself is plain data + string templating for owner
 * slugs), but its issuance consumer (`./issuance.ts`) is Node-only — see that module's header.
 */
import {
  type BeneficialOwnerValues,
  KYB,
  PERSONA_VALUES,
  type PersonaValues,
  RESOURCE_POD_PATHS,
} from "@kyb/data-model";
import type {
  BeneficialOwnershipClaims,
  CredentialKind,
  KybCredentialClaims,
  OfficerAuthorizationClaims,
  OrganisationalIdentityClaims,
} from "@kyb/vc-kit";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

/** Northwind Logistics LLC — the walkthrough's single played business (design §7, fictional). */
export function northwindLogistics(): PersonaValues {
  const values = PERSONA_VALUES[0];
  if (values === undefined || values.id !== "northwind-logistics") {
    throw new Error("@kyb/data-model PERSONA_VALUES is missing the northwind-logistics persona");
  }
  return values;
}

/** Pod paths of the three signed credentials this seeder issues (data-model canon). */
export const CREDENTIAL_POD_PATHS = {
  orgIdentity: RESOURCE_POD_PATHS["org-identity-credential"],
  beneficialOwnership: RESOURCE_POD_PATHS["beneficial-ownership-credential"],
  officerAuthorization: RESOURCE_POD_PATHS["officer-authorization-credential"],
} as const;

/** A stable, URL-safe slug for an owner's pod-relative anchor path. */
function ownerSlug(ownerName: string): string {
  const slug = ownerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  if (slug.length === 0) throw new RangeError(`ownerName produced an empty slug: ${ownerName}`);
  return slug;
}

/** Borrower(business)-only ZK operand-anchor paths (design §4). */
export const ANCHOR_POD_PATHS = {
  /** Tier B (design §4 row 2): the full owner-array commitment — the headline completeness anchor. */
  ownerArrayCommitment: "/kyb/zk/anchor-owner-array",
  /** Tier A (design §4 row 1): one per-owner threshold anchor, keyed by owner slug. */
  ownershipBps: (ownerName: string): string => `/kyb/zk/anchor-bps-${ownerSlug(ownerName)}`,
} as const;

/**
 * The two demo issuer seats this seeder provisions (design §3.2/§5 scene 1): the
 * GLEIF-modelled org-identity + officer-authorization seat, and the unbranded
 * registry/FinCEN-BO-source-modelled beneficial-ownership seat — every issuer identity is
 * hosted ON THE SEEDED POD so verify-on-read runs the full fail-closed gate chain against
 * pod-served documents, never an unresolvable `.example` domain.
 */
export const ISSUER_ROLES = {
  orgIdentityRegistrar: {
    docPath: "/kyb/issuers/org-identity-registrar",
    statusPath: "/kyb/status/org-identity",
    label: "GLEIF-modelled org-identity + officer-authorization seat",
  },
  beneficialOwnershipRegistrar: {
    docPath: "/kyb/issuers/beneficial-ownership-registrar",
    statusPath: "/kyb/status/beneficial-ownership",
    label: "unbranded registry/FinCEN-BO-source-modelled seat",
  },
} as const;

export type KybSeedIssuerRole = keyof typeof ISSUER_ROLES;

/** One scripted credential of the seeded business pod. */
export interface ScriptedCredentialSeed {
  readonly id: keyof typeof CREDENTIAL_POD_PATHS;
  readonly kind: CredentialKind;
  readonly path: string;
  readonly issuerRole: KybSeedIssuerRole;
  readonly statusIndex: number;
  readonly validFrom: Date;
  readonly validUntil: Date;
  readonly claims: KybCredentialClaims;
}

/**
 * The three scripted credential seeds for Northwind Logistics LLC, pinned to the demo
 * canon (design §5 scene 1: backdated -60d / +305d freshness window, matching
 * `packages/data-model/src/personas.ts`'s own envelope offsets so the signed VCs this
 * seeder issues share the same freshness story as the unsigned persona-resource fixtures).
 */
export function scriptedCredentialSeeds(
  values: PersonaValues,
  now: Date,
): readonly ScriptedCredentialSeed[] {
  const window = (validFromDays: number, validUntilDays: number) => ({
    validFrom: daysFrom(now, validFromDays),
    validUntil: daysFrom(now, validUntilDays),
  });

  const orgIdentityClaims: OrganisationalIdentityClaims = {
    kind: "org-identity-credential",
    businessName: values.businessName,
    address: values.homeAddress,
    lei: values.lei,
    legalForm: legalFormIri(values.legalFormLocalName),
  };

  const beneficialOwnershipClaims: BeneficialOwnershipClaims = {
    kind: "beneficial-ownership-credential",
    ownershipRecords: values.owners.map((owner) => ({
      ownerName: owner.name,
      ownershipPercentage: owner.ownershipPercentage,
      ownershipPercentageBps: owner.ownershipPercentageBps,
    })),
  };

  const managingOfficer = values.owners[0];
  if (managingOfficer === undefined) throw new Error("persona must have at least one owner");
  const officerAuthorizationClaims: OfficerAuthorizationClaims = {
    kind: "officer-authorization-credential",
    officer: { officerName: managingOfficer.name, jobTitle: values.managingOfficerJobTitle },
  };

  return [
    {
      id: "orgIdentity",
      kind: "org-identity-credential",
      path: CREDENTIAL_POD_PATHS.orgIdentity,
      issuerRole: "orgIdentityRegistrar",
      statusIndex: 1,
      ...window(-60, 305),
      claims: orgIdentityClaims,
    },
    {
      id: "beneficialOwnership",
      kind: "beneficial-ownership-credential",
      path: CREDENTIAL_POD_PATHS.beneficialOwnership,
      issuerRole: "beneficialOwnershipRegistrar",
      statusIndex: 7,
      ...window(-60, 305),
      claims: beneficialOwnershipClaims,
    },
    {
      id: "officerAuthorization",
      kind: "officer-authorization-credential",
      path: CREDENTIAL_POD_PATHS.officerAuthorization,
      issuerRole: "orgIdentityRegistrar",
      statusIndex: 19,
      ...window(-60, 305),
      claims: officerAuthorizationClaims,
    },
  ];
}

function legalFormIri(localName: PersonaValues["legalFormLocalName"]): string {
  const map: Record<PersonaValues["legalFormLocalName"], string> = {
    LLC: KYB.EntityLegalForm_LLC,
    Corp: KYB.EntityLegalForm_Corp,
    LLP: KYB.EntityLegalForm_LLP,
  };
  return map[localName];
}

/** Validity window of every seeded ZK operand anchor (design §5: near-term, re-checked per bank read). */
export function anchorValidity(now: Date): { validFrom: Date; validUntil: Date } {
  return { validFrom: daysFrom(now, -1), validUntil: daysFrom(now, 14) };
}

export type { BeneficialOwnerValues };
