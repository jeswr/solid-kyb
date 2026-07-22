/**
 * The vault's dev-seeder issuance library: mints Northwind Logistics LLC's three §3.2 KYB
 * credentials (org-identity, beneficial-ownership, officer-authorization) plus the two
 * design §4 ZK operand anchors, ALL genuinely signed through `@kyb/vc-kit`'s ordinary
 * `issueCredential` gate (SHACL before signature, `eddsa-rdfc-2022`). NEVER stubbed: every
 * credential and anchor this module emits is a real signed VC that passes
 * `verifyCredential`'s full fail-closed gate chain against the documents it also emits.
 *
 * Values come from `@kyb/data-model`'s own `PERSONA_VALUES` (Northwind + Jordan Blake/Priya
 * Nandakumar/Marcus Webb/Dana Reyes, design §7) — never re-typed here, so the seeded pod can
 * never drift from the data-model's own persona fixture.
 *
 * TIER A OPERAND-ENCODING GAP (disclosed, not hidden — see the honesty panel and
 * `packages/vc-kit/src/seed-tooling/native.ts`'s header): minting a GENUINE Tier A operand
 * anchor for a NEW `ownershipPercentageBps` value requires sparq's native
 * `encode_int_literal` bridge, gated on a local `SPARQ_CHECKOUT` this environment does not
 * have. This module therefore anchors the Tier A "sample owner" demo proof with the SAME
 * genuine, provenance-tracked captured `filter_int_d4` encoding `@kyb/vc-kit`'s own test
 * suite uses (`packages/vc-kit/test/fixtures/operand-enc.json`, `sparqCommit
 * 947480b02fcbd174f80f9247b55ee02202d2e345`, captured 2026-07-18) — a REAL sparq-encoded
 * value, not a fabricated one, standing in for "a disclosed >=25% owner's stake" until the
 * native bridge is available to encode Jordan's and Priya's exact bps values. Tier B's
 * owner-array commitment needs NO native bridge (`ownershipArrayCommitment` is pure JS), so
 * it anchors the REAL persona array untouched.
 */
import { Buffer } from "node:buffer";
import {
  type IssuedCredential,
  issueCredential,
  type KeyPair,
  MIN_STATUS_LIST_LENGTH,
  publishVerificationMethod,
  StatusListClient,
} from "@kyb/vc-kit";
import { generateKeyPairForSuite, ownershipArrayCommitment } from "@kyb/vc-kit";
import { KYB, PERSONA_VALUES } from "@kyb/data-model";
import { RESOURCE_POD_PATHS } from "@kyb/data-model";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The Northwind Logistics LLC persona (design §7) — the walkthrough's single played
 * business. */
export const NORTHWIND: (typeof PERSONA_VALUES)[number] = (() => {
  const persona = PERSONA_VALUES[0];
  if (persona === undefined) throw new Error("PERSONA_VALUES must contain the Northwind persona");
  return persona;
})();

/** Pod-root-relative paths for the two ZK operand anchors this app seeds (design §4). Not
 * a data-model canon path — these anchors are this app's own seed-tooling convention. */
export const ANCHOR_POD_PATHS = {
  ownershipSample: "/kyb/credentials/anchors/ownership-sample",
  arrayCommitment: "/kyb/credentials/anchors/ownership-array-commitment",
} as const;

export const ISSUER_POD_PATHS = {
  orgIdentityRegistrar: "/kyb/issuers/org-identity#id",
  beneficialOwnershipRegistrar: "/kyb/issuers/beneficial-ownership#id",
} as const;

const STATUS_POD_PATHS = {
  orgIdentityRegistrar: "/kyb/status/org-identity",
  beneficialOwnershipRegistrar: "/kyb/status/beneficial-ownership",
} as const;

/**
 * A REAL genuine `filter_int_d4` operand encoding, captured from a real sparq checkout
 * (see this module's header) — stands in for the Tier A "sample owner" demo proof's
 * anchored value until the native bridge can mint one for Jordan's/Priya's exact bps.
 */
export const TIER_A_SAMPLE_BPS = 2860;
export const TIER_A_SAMPLE_OPERAND_ENC =
  "0x07b66a6df9e52198d3d823f29c5030fd9721dafcf31b7a44da67a0f21d3710b0";

export interface SeededResource {
  readonly path: string;
  readonly body: string;
  readonly contentType: string;
}

export interface SeededKybPod {
  readonly webid: string;
  readonly resources: readonly SeededResource[];
}

interface Issuer {
  readonly iri: string;
  readonly key: KeyPair;
  readonly status: StatusListClient;
  readonly docPath: string;
  readonly docBody: string;
  readonly statusPath: string;
}

async function provisionIssuer(
  podBase: string,
  docPath: string,
  statusPath: string,
  fetchImpl: typeof fetch,
  now: Date,
): Promise<Issuer> {
  const iri = `${podBase}${docPath.slice(1)}`;
  const key = await generateKeyPairForSuite(`${iri}-key-1`, "Ed25519");
  const published = await publishVerificationMethod({ controller: iri, key });
  const statusUrl = `${podBase}${statusPath.slice(1)}`;
  const status = new StatusListClient({ url: statusUrl, issuer: iri, key, fetch: fetchImpl });
  await status.create({
    now,
    validUntil: new Date(now.getTime() + 400 * DAY_MS),
    bits: Buffer.alloc(MIN_STATUS_LIST_LENGTH / 8),
  });
  return { iri, key, status, docPath, docBody: published.turtle, statusPath };
}

/**
 * Seed Northwind Logistics LLC's vault: the three §3.2 KYB credentials plus the two design
 * §4 ZK operand anchors, genuinely signed and written directly to `podBase` (plain,
 * unauthenticated `fetch` — this is the same "dev/demo pod, not production" posture the
 * rest of this app's dev-gated seed route already documents). Idempotent-ish: reuses
 * strict-create PUTs, so a second run against an already-seeded pod will surface 412s from
 * `writeAll` for anyone who calls this against a live pod twice — callers wanting
 * convergence should target a fresh dev pod per boot (the harness pattern this app's tests
 * use) or accept the 412s as "already seeded".
 */
export async function seedNorthwindPod(options: {
  readonly podBase: string;
  readonly webid: string;
  readonly now: Date;
  readonly fetchImpl?: typeof fetch;
}): Promise<SeededKybPod> {
  const { podBase, webid, now } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  const [orgIdentityRegistrar, beneficialOwnershipRegistrar] = await Promise.all([
    provisionIssuer(
      podBase,
      ISSUER_POD_PATHS.orgIdentityRegistrar,
      STATUS_POD_PATHS.orgIdentityRegistrar,
      fetchImpl,
      now,
    ),
    provisionIssuer(
      podBase,
      ISSUER_POD_PATHS.beneficialOwnershipRegistrar,
      STATUS_POD_PATHS.beneficialOwnershipRegistrar,
      fetchImpl,
      now,
    ),
  ]);

  const validity = {
    validFrom: new Date(now.getTime() - 60 * DAY_MS),
    validUntil: new Date(now.getTime() + 305 * DAY_MS),
  };

  const orgIdentity = await issueCredential({
    kind: "org-identity-credential",
    credentialId: `${podBase}${RESOURCE_POD_PATHS["org-identity-credential"].slice(1)}`,
    issuer: orgIdentityRegistrar.iri,
    subject: webid,
    claims: {
      kind: "org-identity-credential",
      businessName: NORTHWIND.businessName,
      address: NORTHWIND.homeAddress,
      lei: NORTHWIND.lei,
      legalForm:
        NORTHWIND.legalFormLocalName === "LLC"
          ? KYB.EntityLegalForm_LLC
          : NORTHWIND.legalFormLocalName === "Corp"
            ? KYB.EntityLegalForm_Corp
            : KYB.EntityLegalForm_LLP,
    },
    validity,
    status: orgIdentityRegistrar.status.entry(1),
    key: orgIdentityRegistrar.key,
  });

  const beneficialOwnership = await issueCredential({
    kind: "beneficial-ownership-credential",
    credentialId: `${podBase}${RESOURCE_POD_PATHS["beneficial-ownership-credential"].slice(1)}`,
    issuer: beneficialOwnershipRegistrar.iri,
    subject: webid,
    claims: {
      kind: "beneficial-ownership-credential",
      ownershipRecords: NORTHWIND.owners.map((owner) => ({
        ownerName: owner.name,
        ownershipPercentage: owner.ownershipPercentage,
        ownershipPercentageBps: owner.ownershipPercentageBps,
      })),
    },
    validity,
    status: beneficialOwnershipRegistrar.status.entry(1),
    key: beneficialOwnershipRegistrar.key,
  });

  const managingOfficer = NORTHWIND.owners[0];
  if (managingOfficer === undefined) throw new Error("Northwind persona must have an owner");
  const officerAuthorization = await issueCredential({
    kind: "officer-authorization-credential",
    credentialId: `${podBase}${RESOURCE_POD_PATHS["officer-authorization-credential"].slice(1)}`,
    issuer: orgIdentityRegistrar.iri,
    subject: webid,
    claims: {
      kind: "officer-authorization-credential",
      officer: { officerName: managingOfficer.name, jobTitle: NORTHWIND.managingOfficerJobTitle },
    },
    validity,
    status: orgIdentityRegistrar.status.entry(2),
    key: orgIdentityRegistrar.key,
  });

  // Tier A "sample owner" anchor: a REAL captured filter_int_d4 operand encoding (see
  // module header) standing in for a disclosed >=25% owner's stake.
  const ownershipSampleAnchor: IssuedCredential = await issueCredential({
    kind: "zk-operand-anchor",
    credentialId: `${podBase}${ANCHOR_POD_PATHS.ownershipSample.slice(1)}`,
    issuer: beneficialOwnershipRegistrar.iri,
    subject: webid,
    claims: {
      kind: "zk-operand-anchor",
      field: KYB.ownershipPercentageBps,
      operandEnc: TIER_A_SAMPLE_OPERAND_ENC,
    },
    validity,
    status: beneficialOwnershipRegistrar.status.entry(3),
    key: beneficialOwnershipRegistrar.key,
  });

  // Tier B array-commitment anchor: the REAL persona array, computed entirely in JS.
  const arrayCommitment = await ownershipArrayCommitment(
    NORTHWIND.owners.map((owner) => owner.ownershipPercentageBps),
  );
  const arrayCommitmentAnchor: IssuedCredential = await issueCredential({
    kind: "zk-operand-anchor",
    credentialId: `${podBase}${ANCHOR_POD_PATHS.arrayCommitment.slice(1)}`,
    issuer: beneficialOwnershipRegistrar.iri,
    subject: webid,
    claims: {
      kind: "zk-operand-anchor",
      field: KYB.beneficialOwnershipArrayCommitment,
      operandEnc: arrayCommitment,
    },
    validity,
    status: beneficialOwnershipRegistrar.status.entry(4),
    key: beneficialOwnershipRegistrar.key,
  });

  const resources: SeededResource[] = [
    {
      path: ISSUER_POD_PATHS.orgIdentityRegistrar.replace(/#id$/, ""),
      body: orgIdentityRegistrar.docBody,
      contentType: "text/turtle",
    },
    {
      path: ISSUER_POD_PATHS.beneficialOwnershipRegistrar.replace(/#id$/, ""),
      body: beneficialOwnershipRegistrar.docBody,
      contentType: "text/turtle",
    },
    {
      path: RESOURCE_POD_PATHS["org-identity-credential"],
      body: orgIdentity.body,
      contentType: orgIdentity.contentType,
    },
    {
      path: RESOURCE_POD_PATHS["beneficial-ownership-credential"],
      body: beneficialOwnership.body,
      contentType: beneficialOwnership.contentType,
    },
    {
      path: RESOURCE_POD_PATHS["officer-authorization-credential"],
      body: officerAuthorization.body,
      contentType: officerAuthorization.contentType,
    },
    {
      path: ANCHOR_POD_PATHS.ownershipSample,
      body: ownershipSampleAnchor.body,
      contentType: ownershipSampleAnchor.contentType,
    },
    {
      path: ANCHOR_POD_PATHS.arrayCommitment,
      body: arrayCommitmentAnchor.body,
      contentType: arrayCommitmentAnchor.contentType,
    },
  ];

  for (const resource of resources) {
    const response = await fetchImpl(`${podBase}${resource.path.slice(1)}`, {
      method: "PUT",
      headers: { "content-type": resource.contentType, "if-none-match": "*" },
      body: resource.body,
    });
    if (!response.ok) {
      throw new Error(`seed PUT ${resource.path} failed: ${response.status}`);
    }
  }

  // Status lists (written directly by StatusListClient.create() above) are reported too,
  // for the caller's manifest — their bodies already live on the pod, not re-PUT here.
  const statusManifest: SeededResource[] = [orgIdentityRegistrar, beneficialOwnershipRegistrar].map(
    (issuer) => ({ path: issuer.statusPath, body: "", contentType: "text/turtle" }),
  );

  return { webid, resources: [...resources, ...statusManifest] };
}
