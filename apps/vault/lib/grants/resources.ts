/**
 * The vault's grantable-resource catalogue (design §3.2/§6.2): the three KYB credentials
 * every relying party in this demo may be granted read access to. Every id below is a
 * SINGLE pod resource the grant/revoke engine manages its OWN resource-level WAC ACL for —
 * `@jeswr/solid-seed`-style seeding provisions each credential owner-only at seed time (see
 * `../server/dev-seed.ts`), so the engine REBUILDS exactly that same document rather than
 * inventing a container scheme.
 *
 * Paths come straight from `@kyb/data-model`'s `RESOURCE_POD_PATHS` (the SAME constant the
 * dev seeder reads) — never re-typed here, so the catalogue can never drift from what is
 * actually seeded.
 */
import { RESOURCE_POD_PATHS } from "@kyb/data-model";

export const RESOURCE_IDS = ["orgIdentity", "beneficialOwnership", "officerAuthorization"] as const;

export type ResourceId = (typeof RESOURCE_IDS)[number];

export function isResourceId(value: string): value is ResourceId {
  return (RESOURCE_IDS as readonly string[]).includes(value);
}

export interface ResourceDefinition {
  readonly id: ResourceId;
  /** Pod-root-relative path (data-model canon for the three seeded credentials). */
  readonly path: string;
  /** Scene-facing label for the grants dashboard + credential list. */
  readonly label: string;
}

export const RESOURCE_CATALOG: Readonly<Record<ResourceId, ResourceDefinition>> = {
  orgIdentity: {
    id: "orgIdentity",
    path: RESOURCE_POD_PATHS["org-identity-credential"],
    label: "Organisational-identity credential",
  },
  beneficialOwnership: {
    id: "beneficialOwnership",
    path: RESOURCE_POD_PATHS["beneficial-ownership-credential"],
    label: "Beneficial-ownership credential",
  },
  officerAuthorization: {
    id: "officerAuthorization",
    path: RESOURCE_POD_PATHS["officer-authorization-credential"],
    label: "Officer-authorization credential",
  },
};

/** The three VCs scene 1 fills — the vault's primary credential-list view. */
export const SEEDED_CREDENTIAL_IDS: readonly ResourceId[] = [
  "orgIdentity",
  "beneficialOwnership",
  "officerAuthorization",
];

export function resourceIri(podBase: string, id: ResourceId): string {
  return `${podBase}${RESOURCE_CATALOG[id].path.slice(1)}`;
}
