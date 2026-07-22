import type { DatasetCore } from "@rdfjs/types";
import { buildIllustrativeLei } from "./lei.ts";
import type { KybResourceKind } from "./shacl.ts";
import { KYB } from "./vocab/kyb.ts";
import {
  buildBeneficialOwnershipCredential,
  buildOfficerAuthorizationCredential,
  buildOrganisationalIdentityCredential,
  type CredentialEnvelopeInit,
  type EntityOwnershipInit,
  type PostalAddressInit,
} from "./wrappers/build.ts";
import type { KybResource } from "./wrappers/resources.ts";
import { resourceToTurtle } from "./wrappers/serialize.ts";

/**
 * The demo persona fixture — Northwind Logistics LLC, the walkthrough's
 * single played business (design §7; fictional, all data simulated, no real
 * PII, no real LEI issuance). KEEP IN SYNC with `walkthrough.persona` in the
 * `tour` app's content document once it exists.
 *
 * ZK threshold pinning: the four beneficial owners' basis-points stakes sum
 * to exactly 10,000 (100%), with Jordan Blake and Priya Nandakumar pinned
 * ABOVE the 2,500-bps (25%) scene-3 proof threshold and Marcus Webb and Dana
 * Reyes pinned BELOW it (design §7) — test-enforced against
 * {@link ZK_OWNERSHIP_THRESHOLD_BPS}.
 *
 * Determinism: `personas()` never reads the clock — all validity windows
 * derive from the caller's `now` — and the same `now` + `seed` produce
 * byte-identical Turtle.
 */

export type PersonaId = "northwind-logistics";

/**
 * Resource kinds present in a deterministic persona seed (the CDD decision
 * record is bank-written — it lives in the bank's own system, not the
 * business vault — and the ZK operand anchor is minted by the vc-kit seed
 * tooling, which owns signatures and operand_enc; same exclusion pattern the
 * lending demo's `PersonaResourceKind` uses for its receipt/anchor kinds).
 */
export type PersonaResourceKind = Exclude<
  KybResourceKind,
  "cdd-decision-record" | "zk-operand-anchor"
>;

/** Pod-root-relative resource paths, under the access-controlled `/kyb/credentials/` subtree. */
export const RESOURCE_POD_PATHS: Readonly<Record<PersonaResourceKind, string>> = {
  "org-identity-credential": "/kyb/credentials/org-identity",
  "beneficial-ownership-credential": "/kyb/credentials/beneficial-ownership",
  "officer-authorization-credential": "/kyb/credentials/officer-authorization",
};

/** The scene-3 ZK beneficial-owner threshold (design §4/§7, pinned): 25% as basis points. */
export const ZK_OWNERSHIP_THRESHOLD_BPS = 2500;

/** Issuer identity IRIs, overridable when seeding against deployed org pods. */
export interface PersonaIssuers {
  /** GLEIF-modelled org-identity seat (scene 1 org-identity VC AND officer-authorization VC — same issuer surface, design §3.2). */
  orgIdentityRegistrar: string;
  /** Unbranded registry/FinCEN-BO-source-modelled seat (scene 1 beneficial-ownership VC). */
  beneficialOwnershipRegistrar: string;
}

const DEFAULT_ISSUERS: PersonaIssuers = {
  orgIdentityRegistrar: "https://issuers.example/orgs/org-identity-registrar#id",
  beneficialOwnershipRegistrar: "https://issuers.example/orgs/beneficial-ownership-registrar#id",
};

export interface PersonaFactoryOptions {
  /**
   * The demo reference instant. REQUIRED: fixtures never read the clock —
   * credential windows are offsets from this value.
   */
  now: Date;
  /** Varies the incidental identifiers (status entries). */
  seed?: string;
  /** Per-persona pod base IRI override (must end with `/`). */
  podBases?: Partial<Record<PersonaId, string>>;
  /**
   * Per-persona WebID override for identities NOT rooted in the pod. Defaults
   * to `${podBase}profile/card#me` — the business's OWN WebID, which every
   * credential's `credentialSubject` follows (holder binding, house rule).
   */
  webIds?: Partial<Record<PersonaId, string>>;
  /** Issuer identity overrides for seeding against deployed org pods. */
  issuers?: Partial<PersonaIssuers>;
}

/** One seeded pod resource: dataset + validated deterministic Turtle. */
export interface PersonaResource {
  kind: PersonaResourceKind;
  /** Pod-root-relative path (RESOURCE_POD_PATHS). */
  path: string;
  /** Absolute resource IRI (podBase + path). */
  iri: string;
  /** Root node for `validate({ expect, focusNode })`. */
  focusNode: string;
  dataset: DatasetCore;
  /** Shape-validated, byte-deterministic Turtle. */
  turtle: string;
}

export interface Persona {
  id: PersonaId;
  displayName: string;
  webId: string;
  podBase: string;
  resources: readonly PersonaResource[];
  /** The same resources keyed by pod path (the seed-layer manifest). */
  byPath: ReadonlyMap<string, PersonaResource>;
}

/** One disclosed beneficial owner, plain values (exported for test assertions). */
export interface BeneficialOwnerValues {
  name: string;
  /** Disclosed display percentage (0..100). */
  ownershipPercentage: number;
  /** ZK d4 field, basis points (0..10000). */
  ownershipPercentageBps: number;
}

/** The plain values the persona is built from (exported for test assertions). */
export interface PersonaValues {
  id: PersonaId;
  businessName: string;
  homeAddress: PostalAddressInit;
  /** One of ENTITY_LEGAL_FORM_IRIS's local names ("LLC" in this demo). */
  legalFormLocalName: "LLC" | "Corp" | "LLP";
  /** ISO 17442-shaped, checksum-valid, always-illustrative LEI (see src/lei.ts). */
  lei: string;
  /** Managing Member / CEO / signatory — also owners[0]. */
  managingOfficerJobTitle: string;
  /** Exactly four owners (design §7), summing to 10,000 bps. */
  owners: readonly BeneficialOwnerValues[];
}

/**
 * Design §7 values, digit-budget-conforming and pinned around the scene-3
 * 2,500-bps threshold: Jordan Blake (42%) and Priya Nandakumar (28%) above;
 * Marcus Webb (18%) and Dana Reyes (12%) below — a real disclosed/undisclosed
 * boundary for the completeness proof to demonstrate.
 */
export const PERSONA_VALUES: readonly PersonaValues[] = [
  {
    id: "northwind-logistics",
    businessName: "Northwind Logistics LLC",
    homeAddress: {
      streetAddress: "1180 Freight Yard Road",
      addressLocality: "Kansas City",
      addressRegion: "MO",
      postalCode: "64105",
    },
    legalFormLocalName: "LLC",
    lei: buildIllustrativeLei("NWLOGISTICS001"),
    managingOfficerJobTitle: "Managing Member & CEO",
    owners: [
      { name: "Jordan Blake", ownershipPercentage: 42, ownershipPercentageBps: 4200 },
      { name: "Priya Nandakumar", ownershipPercentage: 28, ownershipPercentageBps: 2800 },
      { name: "Marcus Webb", ownershipPercentage: 18, ownershipPercentageBps: 1800 },
      { name: "Dana Reyes", ownershipPercentage: 12, ownershipPercentageBps: 1200 },
    ],
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

/** FNV-1a 32-bit: tiny, dependency-free deterministic hash for identifiers. */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function statusEntry(issuer: string, list: string, index: number): string {
  return `${new URL(issuer).origin}/status/${list}#${index}`;
}

function legalFormIri(localName: PersonaValues["legalFormLocalName"]): string {
  const map: Record<PersonaValues["legalFormLocalName"], string> = {
    LLC: KYB.EntityLegalForm_LLC,
    Corp: KYB.EntityLegalForm_Corp,
    LLP: KYB.EntityLegalForm_LLP,
  };
  return map[localName];
}

async function personaResource(
  kind: PersonaResourceKind,
  podBase: string,
  focusNode: string,
  resource: KybResource,
): Promise<PersonaResource> {
  const path = RESOURCE_POD_PATHS[kind];
  return {
    kind,
    path,
    iri: `${podBase}${path.slice(1)}`,
    focusNode,
    dataset: resource.dataset,
    turtle: await resourceToTurtle(resource),
  };
}

async function buildPersona(
  values: PersonaValues,
  options: PersonaFactoryOptions,
  issuers: PersonaIssuers,
): Promise<Persona> {
  const { now } = options;
  const seed = options.seed ?? "solid-kyb-demo";
  const podStem = values.id.split("-")[0] ?? values.id;
  const podBase = options.podBases?.[values.id] ?? `https://${podStem}.pod.example/`;
  if (!podBase.endsWith("/")) {
    throw new RangeError(`podBase must end with "/": ${podBase}`);
  }
  const webId = options.webIds?.[values.id] ?? `${podBase}profile/card#me`;
  const resourceIri = (kind: PersonaResourceKind): string =>
    `${podBase}${RESOURCE_POD_PATHS[kind].slice(1)}`;
  const derived = (label: string, modulus: number): number =>
    fnv1a32(`${seed}:${values.id}:${label}`) % modulus;
  const envelope = (
    kind: PersonaResourceKind,
    issuer: string,
    list: string,
    validFromDays: number,
    validUntilDays: number,
  ): CredentialEnvelopeInit => ({
    iri: resourceIri(kind),
    issuer,
    validFrom: daysFrom(now, validFromDays),
    validUntil: daysFrom(now, validUntilDays),
    credentialStatus: statusEntry(issuer, list, derived(list, 1024)),
    credentialSubject: webId,
  });

  const orgIdentity = buildOrganisationalIdentityCredential({
    ...envelope("org-identity-credential", issuers.orgIdentityRegistrar, "org-identity", -60, 305),
    businessName: values.businessName,
    address: values.homeAddress,
    lei: values.lei,
    legalForm: legalFormIri(values.legalFormLocalName),
  });

  const beneficialOwnership = buildBeneficialOwnershipCredential({
    ...envelope(
      "beneficial-ownership-credential",
      issuers.beneficialOwnershipRegistrar,
      "beneficial-ownership",
      -60,
      305,
    ),
    ownedEntity: webId,
    ownershipRecords: values.owners.map(
      (owner): EntityOwnershipInit => ({
        ownerName: owner.name,
        ownershipPercentage: owner.ownershipPercentage,
        ownershipPercentageBps: owner.ownershipPercentageBps,
      }),
    ),
  });

  const managingOfficer = values.owners[0];
  if (managingOfficer === undefined) throw new Error("persona must have at least one owner");
  const officerAuthorization = buildOfficerAuthorizationCredential({
    ...envelope(
      "officer-authorization-credential",
      issuers.orgIdentityRegistrar,
      "officer-authorization",
      -60,
      305,
    ),
    business: webId,
    officer: {
      officerName: managingOfficer.name,
      jobTitle: values.managingOfficerJobTitle,
    },
  });

  const resources = await Promise.all([
    personaResource("org-identity-credential", podBase, orgIdentity.value, orgIdentity),
    personaResource(
      "beneficial-ownership-credential",
      podBase,
      beneficialOwnership.value,
      beneficialOwnership,
    ),
    personaResource(
      "officer-authorization-credential",
      podBase,
      officerAuthorization.value,
      officerAuthorization,
    ),
  ]);

  return {
    id: values.id,
    displayName: values.businessName,
    webId,
    podBase,
    resources,
    byPath: new Map(resources.map((resource) => [resource.path, resource])),
  };
}

/**
 * Build the demo persona (Northwind Logistics LLC) with all three §3.2 pod
 * resources built through the typed wrappers, validated against their SHACL
 * shapes, and serialised to deterministic Turtle. Same `now` + `seed` =>
 * byte-identical output. These are the UNSIGNED wrapper documents; the
 * vc-kit seed tooling turns them into genuinely signed credentials.
 */
export async function personas(options: PersonaFactoryOptions): Promise<readonly Persona[]> {
  const issuers: PersonaIssuers = { ...DEFAULT_ISSUERS, ...options.issuers };
  return Promise.all(PERSONA_VALUES.map((values) => buildPersona(values, options, issuers)));
}
