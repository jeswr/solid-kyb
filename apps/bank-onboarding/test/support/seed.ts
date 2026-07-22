/**
 * This app's OWN test-fixture seeder: mints Northwind Logistics LLC's three
 * design §3.2 KYB credentials (org-identity, beneficial-ownership, officer-
 * authorization) plus the two design §4 ZK operand anchors, ALL genuinely
 * signed through `@kyb/vc-kit`'s ordinary `issueCredential` gate (SHACL
 * before signature, `eddsa-rdfc-2022`) — mirrors `apps/vault`'s own
 * `lib/server/kyb-issuance.ts` seeder (app-local, not a shared package;
 * every app that needs a genuinely-signed test pod builds its own), adapted
 * to ALSO write the WAC grant this app's rail needs to read as a THIRD
 * PARTY (`apps/vault`'s grant engine is out of scope for this app's own
 * tests; this seeder locks each resource with `acl:agent <business>` +
 * `acl:agent <bank service webid>` directly, matching the shape a live
 * vault grant would produce).
 *
 * TIER A OPERAND-ENCODING GAP (disclosed, not hidden — same gap
 * `apps/vault`'s seeder documents): minting a GENUINE Tier A operand anchor
 * for a NEW `ownershipPercentageBps` value needs sparq's native
 * `encode_int_literal` bridge (`SPARQ_CHECKOUT`), unavailable in this
 * environment. This seeder anchors the Tier A "sample owner" proof with the
 * SAME genuine, provenance-tracked captured `filter_int_d4` encoding
 * `@kyb/vc-kit`'s own test suite uses (`packages/vc-kit/test/fixtures/operand-enc.json`,
 * `sparqCommit 947480b02fcbd174f80f9247b55ee02202d2e345`, captured
 * 2026-07-18) — a REAL sparq-encoded value, not fabricated.
 *
 * Tier B's owner-array commitment needs NO native bridge
 * (`ownershipArrayCommitment` is pure JS Blake3), so callers can anchor
 * WHATEVER true owner array a scenario needs — including a "hidden owner"
 * array that diverges from what the disclosed `BeneficialOwnershipCredential`
 * shows, for the adversarial completeness tests.
 */
import { Buffer } from "node:buffer";
import type { BeneficialOwnerValues } from "@kyb/data-model";
import { KYB, PERSONA_VALUES } from "@kyb/data-model";
import {
  generateKeyPairForSuite,
  type IssuedCredential,
  issueCredential,
  type KeyPair,
  MIN_STATUS_LIST_LENGTH,
  ownershipArrayCommitment,
  publishVerificationMethod,
  StatusListClient,
} from "@kyb/vc-kit";
import { ANCHOR_POD_PATHS, CREDENTIAL_POD_PATHS } from "../../lib/server/pod-resources";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The walkthrough's single played business (design §7). */
export const NORTHWIND: (typeof PERSONA_VALUES)[number] = (() => {
  const persona = PERSONA_VALUES[0];
  if (persona === undefined) throw new Error("PERSONA_VALUES must contain the Northwind persona");
  return persona;
})();

export const ISSUER_POD_PATHS = {
  orgIdentityRegistrar: "/kyb/issuers/org-identity#id",
  beneficialOwnershipRegistrar: "/kyb/issuers/beneficial-ownership#id",
} as const;

const STATUS_POD_PATHS = {
  orgIdentityRegistrar: "/kyb/status/org-identity",
  beneficialOwnershipRegistrar: "/kyb/status/beneficial-ownership",
} as const;

/** A REAL genuine `filter_int_d4` operand encoding, captured from a real sparq checkout
 * (see this module's header) — stands in for the Tier A "sample owner" demo proof's
 * anchored value until the native bridge can mint one for Jordan's exact bps. */
export const SAMPLE_OWNER_BPS = 2860;
export const SAMPLE_OWNER_OPERAND_ENC =
  "0x07b66a6df9e52198d3d823f29c5030fd9721dafcf31b7a44da67a0f21d3710b0";

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
  return { docBody: published.turtle, docPath, iri, key, status, statusPath };
}

/** Public-read ACL for issuer-side resources (the registrar's own WebID/verification-method
 * document and its Bitstring status list) — real Solid deployments publish these openly
 * (anyone must be able to resolve an issuer's key and check revocation), unlike the
 * business's own private credentials, which are per-agent granted below. */
function publicReadAcl(resourcePath: string, ownerWebid: string): string {
  return `@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .

<#public> a acl:Authorization ; acl:accessTo <${resourcePath}> ; acl:agentClass foaf:Agent ; acl:mode acl:Read .
<#owner> a acl:Authorization ; acl:accessTo <${resourcePath}> ; acl:agent <${ownerWebid}> ; acl:mode acl:Read, acl:Write, acl:Control .
`;
}

function grantAcl(
  resourcePath: string,
  ownerWebid: string,
  grantedWebIds: readonly string[],
): string {
  const lines = [
    "@prefix acl: <http://www.w3.org/ns/auth/acl#> .",
    "",
    "<#owner>",
    "    a acl:Authorization ;",
    `    acl:accessTo <${resourcePath}> ;`,
    `    acl:agent <${ownerWebid}> ;`,
    "    acl:mode acl:Read, acl:Write, acl:Control .",
  ];
  grantedWebIds.forEach((agent, index) => {
    lines.push(
      "",
      `<#grant-${index}>`,
      "    a acl:Authorization ;",
      `    acl:accessTo <${resourcePath}> ;`,
      `    acl:agent <${agent}> ;`,
      "    acl:mode acl:Read .",
    );
  });
  return `${lines.join("\n")}\n`;
}

export interface SeedOnboardingPodOptions {
  readonly podBase: string;
  readonly webid: string;
  readonly now: Date;
  readonly fetchImpl: typeof fetch;
  /** The bank's OWN service WebID — granted READ on every credential + anchor below. */
  readonly bankServiceWebId: string;
  /** The values written into the DISCLOSED BeneficialOwnershipCredential. Defaults to
   * Northwind's real four owners. */
  readonly disclosedOwners?: readonly BeneficialOwnerValues[];
  /**
   * The TRUE array the Tier B array-commitment anchor is genuinely computed over. Defaults
   * to the SAME values as `disclosedOwners` (the honest case). Pass a DIFFERENT array to
   * simulate a beneficial-ownership registrar that anchors a truth the disclosed credential
   * does not match — the "hidden >= 25% owner" adversarial fixture.
   */
  readonly trueOwnerBps?: readonly number[];
}

export interface SeededOnboardingPod {
  readonly orgIdentityIri: string;
  readonly beneficialOwnershipIri: string;
  readonly officerAuthorizationIri: string;
  readonly sampleAnchorIri: string;
  readonly arrayCommitmentIri: string;
  readonly orgIdentityRegistrar: string;
  readonly beneficialOwnershipRegistrar: string;
}

/**
 * Seed one business pod with the three real signed KYB credentials, the two
 * real ZK operand anchors, and a WAC grant on all five resources to
 * `bankServiceWebId` (mirroring what a live `apps/vault` grant would leave
 * behind). Strict-create PUTs — call against a fresh pod per test.
 */
export async function seedOnboardingPod(
  options: SeedOnboardingPodOptions,
): Promise<SeededOnboardingPod> {
  const { podBase, webid, now, fetchImpl, bankServiceWebId } = options;
  const owners = options.disclosedOwners ?? NORTHWIND.owners;
  const trueOwnerBps = options.trueOwnerBps ?? owners.map((owner) => owner.ownershipPercentageBps);

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
    claims: {
      address: NORTHWIND.homeAddress,
      businessName: NORTHWIND.businessName,
      kind: "org-identity-credential",
      legalForm: KYB.EntityLegalForm_LLC,
      lei: NORTHWIND.lei,
    },
    credentialId: `${podBase}${CREDENTIAL_POD_PATHS["org-identity-credential"].slice(1)}`,
    issuer: orgIdentityRegistrar.iri,
    key: orgIdentityRegistrar.key,
    kind: "org-identity-credential",
    status: orgIdentityRegistrar.status.entry(1),
    subject: webid,
    validity,
  });

  const beneficialOwnership = await issueCredential({
    claims: {
      kind: "beneficial-ownership-credential",
      ownershipRecords: owners.map((owner) => ({
        ownerName: owner.name,
        ownershipPercentage: owner.ownershipPercentage,
        ownershipPercentageBps: owner.ownershipPercentageBps,
      })),
    },
    credentialId: `${podBase}${CREDENTIAL_POD_PATHS["beneficial-ownership-credential"].slice(1)}`,
    issuer: beneficialOwnershipRegistrar.iri,
    key: beneficialOwnershipRegistrar.key,
    kind: "beneficial-ownership-credential",
    status: beneficialOwnershipRegistrar.status.entry(2),
    subject: webid,
    validity,
  });

  const managingOfficer = owners[0];
  if (managingOfficer === undefined) throw new Error("persona must have at least one owner");
  const officerAuthorization = await issueCredential({
    claims: {
      kind: "officer-authorization-credential",
      officer: { jobTitle: NORTHWIND.managingOfficerJobTitle, officerName: managingOfficer.name },
    },
    credentialId: `${podBase}${CREDENTIAL_POD_PATHS["officer-authorization-credential"].slice(1)}`,
    issuer: orgIdentityRegistrar.iri,
    key: orgIdentityRegistrar.key,
    kind: "officer-authorization-credential",
    status: orgIdentityRegistrar.status.entry(2),
    subject: webid,
    validity,
  });

  // Tier A "sample owner" anchor: a REAL captured filter_int_d4 operand encoding.
  const sampleAnchor: IssuedCredential = await issueCredential({
    claims: {
      field: KYB.ownershipPercentageBps,
      kind: "zk-operand-anchor",
      operandEnc: SAMPLE_OWNER_OPERAND_ENC,
    },
    credentialId: `${podBase}${ANCHOR_POD_PATHS.ownershipSample.slice(1)}`,
    issuer: beneficialOwnershipRegistrar.iri,
    key: beneficialOwnershipRegistrar.key,
    kind: "zk-operand-anchor",
    status: beneficialOwnershipRegistrar.status.entry(3),
    subject: webid,
    validity,
  });

  // Tier B array-commitment anchor: the REAL (possibly TRUE-but-undisclosed) array,
  // computed entirely in JS.
  const arrayCommitment = await ownershipArrayCommitment(trueOwnerBps);
  const arrayCommitmentAnchor: IssuedCredential = await issueCredential({
    claims: {
      field: KYB.beneficialOwnershipArrayCommitment,
      kind: "zk-operand-anchor",
      operandEnc: arrayCommitment,
    },
    credentialId: `${podBase}${ANCHOR_POD_PATHS.arrayCommitment.slice(1)}`,
    issuer: beneficialOwnershipRegistrar.iri,
    key: beneficialOwnershipRegistrar.key,
    kind: "zk-operand-anchor",
    status: beneficialOwnershipRegistrar.status.entry(4),
    subject: webid,
    validity,
  });

  const resources: readonly { path: string; body: string; contentType: string }[] = [
    {
      body: orgIdentityRegistrar.docBody,
      contentType: "text/turtle",
      path: ISSUER_POD_PATHS.orgIdentityRegistrar.replace(/#id$/, ""),
    },
    {
      body: beneficialOwnershipRegistrar.docBody,
      contentType: "text/turtle",
      path: ISSUER_POD_PATHS.beneficialOwnershipRegistrar.replace(/#id$/, ""),
    },
    {
      body: orgIdentity.body,
      contentType: orgIdentity.contentType,
      path: CREDENTIAL_POD_PATHS["org-identity-credential"],
    },
    {
      body: beneficialOwnership.body,
      contentType: beneficialOwnership.contentType,
      path: CREDENTIAL_POD_PATHS["beneficial-ownership-credential"],
    },
    {
      body: officerAuthorization.body,
      contentType: officerAuthorization.contentType,
      path: CREDENTIAL_POD_PATHS["officer-authorization-credential"],
    },
    {
      body: sampleAnchor.body,
      contentType: sampleAnchor.contentType,
      path: ANCHOR_POD_PATHS.ownershipSample,
    },
    {
      body: arrayCommitmentAnchor.body,
      contentType: arrayCommitmentAnchor.contentType,
      path: ANCHOR_POD_PATHS.arrayCommitment,
    },
  ];

  for (const resource of resources) {
    const response = await fetchImpl(`${podBase}${resource.path.slice(1)}`, {
      body: resource.body,
      headers: { "content-type": resource.contentType, "if-none-match": "*" },
      method: "PUT",
    });
    if (!response.ok) throw new Error(`seed PUT ${resource.path} failed: ${response.status}`);
  }

  // Public-read the issuer WebID/verification-method documents + their Bitstring status
  // lists — real deployments publish these openly (see `publicReadAcl`'s header); without
  // this, the bank's OWN verifyCredential call cannot resolve the issuer's key or check
  // revocation status and fails closed (STATUS_UNREACHABLE / INVALID_SIGNATURE), which is
  // correct fail-closed behaviour but not what this fixture is testing.
  const publicResources = [
    ISSUER_POD_PATHS.orgIdentityRegistrar.replace(/#id$/, ""),
    ISSUER_POD_PATHS.beneficialOwnershipRegistrar.replace(/#id$/, ""),
    STATUS_POD_PATHS.orgIdentityRegistrar,
    STATUS_POD_PATHS.beneficialOwnershipRegistrar,
  ];
  for (const path of publicResources) {
    const resourceIri = `${podBase}${path.slice(1)}`;
    const aclResponse = await fetchImpl(`${resourceIri}.acl`, {
      body: publicReadAcl(resourceIri, webid),
      headers: { "content-type": "text/turtle", "if-none-match": "*" },
      method: "PUT",
    });
    if (!aclResponse.ok) {
      throw new Error(`seed ACL PUT ${path}.acl failed: ${aclResponse.status}`);
    }
  }

  // Grant the bank's service WebID read on exactly the three credentials + two anchors
  // (mirrors what a live `apps/vault` grant leaves behind on the pod — see module header).
  const grantable = [
    CREDENTIAL_POD_PATHS["org-identity-credential"],
    CREDENTIAL_POD_PATHS["beneficial-ownership-credential"],
    CREDENTIAL_POD_PATHS["officer-authorization-credential"],
    ANCHOR_POD_PATHS.ownershipSample,
    ANCHOR_POD_PATHS.arrayCommitment,
  ];
  for (const path of grantable) {
    const resourceIri = `${podBase}${path.slice(1)}`;
    const aclResponse = await fetchImpl(`${resourceIri}.acl`, {
      body: grantAcl(resourceIri, webid, [bankServiceWebId]),
      headers: { "content-type": "text/turtle", "if-none-match": "*" },
      method: "PUT",
    });
    if (!aclResponse.ok) {
      throw new Error(`seed ACL PUT ${path}.acl failed: ${aclResponse.status}`);
    }
  }

  return {
    arrayCommitmentIri: `${podBase}${ANCHOR_POD_PATHS.arrayCommitment.slice(1)}`,
    beneficialOwnershipIri: `${podBase}${CREDENTIAL_POD_PATHS["beneficial-ownership-credential"].slice(1)}`,
    beneficialOwnershipRegistrar: beneficialOwnershipRegistrar.iri,
    officerAuthorizationIri: `${podBase}${CREDENTIAL_POD_PATHS["officer-authorization-credential"].slice(1)}`,
    orgIdentityIri: `${podBase}${CREDENTIAL_POD_PATHS["org-identity-credential"].slice(1)}`,
    orgIdentityRegistrar: orgIdentityRegistrar.iri,
    sampleAnchorIri: `${podBase}${ANCHOR_POD_PATHS.ownershipSample.slice(1)}`,
  };
}
