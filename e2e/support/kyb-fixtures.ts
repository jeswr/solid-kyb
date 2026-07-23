/**
 * Real, signed KYB pod fixtures for the cross-app journey. This module fills
 * the gap between THREE mutually-inconsistent seeding conventions already
 * living in this repo (`@kyb/seeds`'s `seedKybPod`, `apps/vault`'s own
 * `lib/server/kyb-issuance.ts`, and `apps/bank-onboarding`'s
 * `test/support/seed.ts`) — each app-local dev/test seeder mints issuer
 * WebIDs and ZK-anchor paths at ITS OWN convention, undocumented as a
 * cross-app contract anywhere. Confirmed by direct inspection:
 *
 *  - `apps/vault`'s `/api/dev/credentials` verify-on-view route hardcodes
 *    the trusted issuer as `${podBase}kyb/issuers/{org-identity,
 *    beneficial-ownership}#id` (`lib/server/credential-summary.ts` via
 *    `lib/server/kyb-issuance.ts`'s `ISSUER_POD_PATHS`) — NOT
 *    `@kyb/seeds`'s `/kyb/issuers/{org-identity,beneficial-ownership}
 *    -registrar` (no `#id` fragment). Seeding through `@kyb/seeds` would
 *    make vault's OWN verify-on-view page fail closed with an untrusted-
 *    issuer rejection — the opposite of "non-vacuous."
 *  - `apps/bank-onboarding`'s decision rail hardcodes its two ZK anchor
 *    paths as `/kyb/credentials/zk/owner-sample-bps` and
 *    `/kyb/credentials/zk/beneficial-ownership-array-commitment`
 *    (`lib/server/pod-resources.ts`) — matching neither `@kyb/seeds`'s
 *    (`/kyb/zk/anchor-*`) nor vault's own seeder's (`/kyb/credentials/
 *    anchors/*`) anchor paths.
 *  - `apps/issuers`'s LIVE `/api/issue` rail — the only genuinely
 *    cross-zone, real-DPoP issuance path in this journey — mints its Tier B
 *    array-commitment anchor at EXACTLY bank-onboarding's expected path
 *    (`ARRAY_COMMITMENT_ANCHOR_PATH`, `apps/issuers/lib/server/flows.ts`),
 *    which is why this journey drives the LIVE issuers app for scene 1/2
 *    rather than any offline seeder for Northwind's credentials — see
 *    `journey.spec.ts`'s header.
 *
 * This module therefore mints issuer identities at VAULT's convention
 * (so scene 1's verify-on-view is real) that the LIVE issuers app is then
 * CONFIGURED to sign with (so scene 2's issuance is genuinely cross-zone),
 * plus the ONE Tier A anchor the live issuers app deliberately never mints
 * (`"not-implemented-in-live-app"`, needs the native sparq bridge this
 * environment does not have) — reusing the SAME real, provenance-tracked
 * captured `filter_int_d4` encoding `apps/bank-onboarding`'s own acceptance
 * suite uses (`test/support/seed.ts`, `sparqCommit
 * 947480b02fcbd174f80f9247b55ee02202d2e345`, captured 2026-07-18) — never a
 * fabricated value.
 *
 * The scene-4 "hidden owner" variant business is seeded ENTIRELY by this
 * module (the live issuers app's claims are pinned to `PERSONA_VALUES[0]`
 * and cannot represent a divergent persona) — mirroring
 * `apps/bank-onboarding/test/support/seed.ts`'s OWN already-proven
 * `trueOwnerBps` adversarial fixture verbatim (same real captured Tier A
 * value, same pure-JS Tier B array commitment, same disclosed/true
 * divergence recipe that app's own acceptance suite exercises).
 */
import {
  type BeneficialOwnerValues,
  KYB,
  type PersonaValues,
  PERSONA_VALUES,
} from "@kyb/data-model";
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** The walkthrough's single played business (design §7). */
export const NORTHWIND: PersonaValues = (() => {
  const persona = PERSONA_VALUES[0];
  if (persona === undefined || persona.id !== "northwind-logistics") {
    throw new Error("@kyb/data-model PERSONA_VALUES is missing the northwind-logistics persona");
  }
  return persona;
})();

/** `apps/vault`'s OWN dev-seeder issuer convention (`lib/server/kyb-issuance.ts`'s
 * `ISSUER_POD_PATHS`) — vault's `/api/dev/credentials` verify-on-view route hardcodes
 * these EXACT paths as its trusted issuers. */
export const VAULT_ISSUER_POD_PATHS = {
  orgIdentityRegistrar: "/kyb/issuers/org-identity#id",
  beneficialOwnershipRegistrar: "/kyb/issuers/beneficial-ownership#id",
} as const;

const STATUS_POD_PATHS = {
  orgIdentityRegistrar: "/kyb/status/org-identity",
  beneficialOwnershipRegistrar: "/kyb/status/beneficial-ownership",
  officerAuthorizationRegistrar: "/kyb/status/officer-authorization",
} as const;

/** `apps/bank-onboarding`'s OWN ZK-anchor convention (`lib/server/pod-resources.ts`'s
 * `ANCHOR_POD_PATHS`) — the array-commitment path DOUBLES as `apps/issuers`'s
 * `ARRAY_COMMITMENT_ANCHOR_PATH` (verified identical), so the LIVE issuers app's Tier B
 * mint lands exactly where bank-onboarding reads it. */
export const ANCHOR_POD_PATHS = {
  ownershipSample: "/kyb/credentials/zk/owner-sample-bps",
  arrayCommitment: "/kyb/credentials/zk/beneficial-ownership-array-commitment",
} as const;

/** A REAL genuine `filter_int_d4` operand encoding, captured from a real sparq checkout
 * (`packages/vc-kit/test/fixtures/operand-enc.json`, `sparqCommit
 * 947480b02fcbd174f80f9247b55ee02202d2e345`, captured 2026-07-18) — stands in for the
 * Tier A "sample owner" demo proof's anchored value until the native
 * `encode_int_literal` bridge (`SPARQ_CHECKOUT`) is available to encode a disclosed
 * owner's exact bps. Verified byte-identical against that fixture file. */
export const SAMPLE_OWNER_BPS = 2860;
export const SAMPLE_OWNER_OPERAND_ENC =
  "0x07b66a6df9e52198d3d823f29c5030fd9721dafcf31b7a44da67a0f21d3710b0";

export interface ProvisionedPodIssuer {
  readonly webId: string;
  readonly key: KeyPair;
  readonly statusList: StatusListClient;
  readonly docPath: string;
  readonly docBody: string;
  readonly verificationMethod: string;
}

/** Generate + publish one pod-hosted issuer identity at `docPath#id` (vault's own
 * convention: the WebID is the document IRI + `#id`, NOT a separate document). Does
 * NOT create the status list — the live issuers app auto-creates it on first issue
 * (`ensureStatusList`); callers that never touch the live app (the scene-4 variant)
 * must call `.statusList.create()` themselves. */
export async function provisionPodIssuer(
  podBase: string,
  docPath: string,
  statusPath: string,
  fetchImpl: typeof fetch,
): Promise<ProvisionedPodIssuer> {
  const webId = `${podBase}${docPath.slice(1)}#id`;
  const key = await generateKeyPairForSuite(`${webId}-key-1`, "Ed25519");
  const published = await publishVerificationMethod({ controller: webId, key });
  const statusUrl = `${podBase}${statusPath.slice(1)}`;
  const statusList = new StatusListClient({ url: statusUrl, issuer: webId, key, fetch: fetchImpl });
  return {
    webId,
    key,
    statusList,
    docPath,
    docBody: published.turtle,
    verificationMethod: published.verificationMethod,
  };
}

/** Public-read ACL for issuer-side resources (WebID/verification-method documents,
 * Bitstring status lists) — real deployments publish these openly. */
export function publicReadAcl(resourcePath: string, ownerWebid: string): string {
  return `@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .

<#public> a acl:Authorization ; acl:accessTo <${resourcePath}> ; acl:agentClass foaf:Agent ; acl:mode acl:Read .
<#owner> a acl:Authorization ; acl:accessTo <${resourcePath}> ; acl:agent <${ownerWebid}> ; acl:mode acl:Read, acl:Write, acl:Control .
`;
}

/**
 * Public-read ACL for one of the THREE catalogue credentials, PLUS the vault's own
 * service identity at Read/Write/Control — needed for the scene-1 pre-grant
 * verify-on-view window (see `journey.spec.ts`'s scene 1 comment): a plain
 * `publicReadAcl` would grant `foaf:Agent` read but drop `vault-service`'s access
 * entirely (an `.acl` document's OWN readability needs `acl:Control` on the TARGET
 * resource, which `foaf:Agent:Read` does not confer) — vault's grant engine
 * (`readAclSnapshot`) would then 502 trying to inspect the very ACL it needs to
 * rebuild on the FIRST grant. `vault-service` here is a placeholder authorization the
 * first real grant call unconditionally REPLACES (`writeAclDocument` rebuilds the
 * whole document), so this public-read window never survives past scene 1.
 */
export function publicReadAndVaultServiceAcl(
  resourcePath: string,
  ownerWebid: string,
  vaultServiceWebId: string,
): string {
  return `@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .

<#public> a acl:Authorization ; acl:accessTo <${resourcePath}> ; acl:agentClass foaf:Agent ; acl:mode acl:Read .
<#owner> a acl:Authorization ; acl:accessTo <${resourcePath}> ; acl:agent <${ownerWebid}> ; acl:mode acl:Read, acl:Write, acl:Control .
<#vault-service> a acl:Authorization ; acl:accessTo <${resourcePath}> ; acl:agent <${vaultServiceWebId}> ; acl:mode acl:Read, acl:Write, acl:Control .
`;
}

/** Resource-specific ACL granting the owner full control plus each of `grantedWebIds`
 * Read-only — the direct-grant shape used for ZK anchors (vault's grant catalogue does
 * not yet cover them — a documented cross-app gap, `apps/bank-onboarding/lib/server/
 * pod-resources.ts`'s header). */
export function directGrantAcl(
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

/** A container's `acl:default` authorization block for one agent. */
function containerAuthorization(
  id: string,
  container: string,
  agent: string,
  modes: string,
): string {
  return `<#${id}>
    a acl:Authorization ;
    acl:accessTo <${container}> ;
    acl:default <${container}> ;
    acl:agent <${agent}> ;
    acl:mode ${modes} .
`;
}

/** The `/kyb/` container's default ACL: the business owns it; the issuers app's and
 * vault's OWN service identities get Read/Write(/Control) so they can create
 * not-yet-existing resources under it (credentials, ZK anchors, issuer docs, status
 * lists, the receipts + access-policies subcontainers). `adminWebId` is the pod's OWN
 * bootstrap identity (`SolidTestAccount.webid`) — WAC is resource-hierarchy-scoped: once
 * THIS container gets its own `.acl`, that document (not the pod-root default) governs
 * everything beneath it, so the bootstrap identity must be named explicitly here too or
 * every subsequent admin seed-write under `/kyb/` 403s. `bankCreditServiceWebId` gets
 * Read/Write too: `apps/bank-credit`'s decision rail writes its OWN
 * `kyb:CddDecisionRecord` to `/kyb/decisions/bank-credit` — a brand-new resource under a
 * path vault's grant catalogue never covers (it only manages the three credentials). */
export function kybContainerAcl(
  containerIri: string,
  ownerWebid: string,
  adminWebId: string,
  issuersServiceWebId: string,
  vaultServiceWebId: string,
  bankCreditServiceWebId: string,
): string {
  return (
    "@prefix acl: <http://www.w3.org/ns/auth/acl#> .\n\n" +
    containerAuthorization("owner", containerIri, ownerWebid, "acl:Read, acl:Write, acl:Control") +
    "\n" +
    containerAuthorization("admin", containerIri, adminWebId, "acl:Read, acl:Write, acl:Control") +
    "\n" +
    containerAuthorization(
      "issuers-service",
      containerIri,
      issuersServiceWebId,
      "acl:Read, acl:Write",
    ) +
    "\n" +
    containerAuthorization(
      "vault-service",
      containerIri,
      vaultServiceWebId,
      "acl:Read, acl:Write, acl:Control",
    ) +
    "\n" +
    containerAuthorization(
      "bank-credit-service",
      containerIri,
      bankCreditServiceWebId,
      "acl:Read, acl:Write",
    )
  );
}

function daysFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

/** Mint the Tier A "sample owner" ZK-operand-anchor credential at bank-onboarding's
 * expected path, using the REAL captured `filter_int_d4` encoding (never fabricated —
 * see this module's header). Signed by the beneficial-ownership registrar (the SAME
 * issuer seat `apps/bank-onboarding/test/support/seed.ts` anchors it with). */
export async function mintSampleOwnerAnchor(options: {
  readonly podBase: string;
  readonly subject: string;
  readonly issuer: ProvisionedPodIssuer;
  readonly now: Date;
  readonly statusIndex: number;
  readonly podFetch: typeof fetch;
}): Promise<IssuedCredential> {
  const validity = {
    validFrom: daysFrom(options.now, -1),
    validUntil: daysFrom(options.now, 14),
  };
  return issueCredential({
    claims: {
      field: KYB.ownershipPercentageBps,
      kind: "zk-operand-anchor",
      operandEnc: SAMPLE_OWNER_OPERAND_ENC,
    },
    credentialId: `${options.podBase}${ANCHOR_POD_PATHS.ownershipSample.slice(1)}`,
    issuer: options.issuer.webId,
    key: options.issuer.key,
    kind: "zk-operand-anchor",
    status: options.issuer.statusList.entry(options.statusIndex),
    subject: options.subject,
    validity,
  });
}

// ---------------------------------------------------------------------------------
// Scene 4: the "hidden >=25% owner" counterfactual variant — seeded ENTIRELY here
// (the live issuers app's claims are pinned to Northwind's real PERSONA_VALUES[0]
// and cannot represent a divergent persona). Mirrors
// `apps/bank-onboarding/test/support/seed.ts`'s `seedOnboardingPod` recipe, the
// SAME real captured Tier A value and pure-JS Tier B array commitment.
// ---------------------------------------------------------------------------------

export interface SeedHiddenOwnerVariantOptions {
  readonly podBase: string;
  readonly webid: string;
  readonly now: Date;
  readonly fetchImpl: typeof fetch;
  /** The bank-onboarding service WebID — granted READ on every credential + anchor
   * directly (this variant never goes through vault's live grant rail — it exists
   * solely to drive bank-onboarding's decision route for the decline demonstration). */
  readonly bankOnboardingServiceWebId: string;
  /** The DISCLOSED owners (what the beneficial-ownership credential shows). */
  readonly disclosedOwners: readonly BeneficialOwnerValues[];
  /** The TRUE full owner array the Tier B array-commitment anchor is genuinely
   * computed over (may diverge from `disclosedOwners`' bps — the "hidden owner"). */
  readonly trueOwnerBps: readonly number[];
}

export interface SeededHiddenOwnerVariant {
  readonly orgIdentityIri: string;
  readonly beneficialOwnershipIri: string;
  readonly officerAuthorizationIri: string;
  readonly sampleAnchorIri: string;
  readonly arrayCommitmentIri: string;
  readonly orgIdentityRegistrarWebId: string;
  readonly beneficialOwnershipRegistrarWebId: string;
}

export async function seedHiddenOwnerVariant(
  options: SeedHiddenOwnerVariantOptions,
): Promise<SeededHiddenOwnerVariant> {
  const { podBase, webid, now, fetchImpl, bankOnboardingServiceWebId, disclosedOwners } = options;

  const [orgIdentityRegistrar, beneficialOwnershipRegistrar] = await Promise.all([
    provisionPodIssuer(
      podBase,
      "/kyb/issuers/org-identity",
      STATUS_POD_PATHS.orgIdentityRegistrar,
      fetchImpl,
    ),
    provisionPodIssuer(
      podBase,
      "/kyb/issuers/beneficial-ownership",
      STATUS_POD_PATHS.beneficialOwnershipRegistrar,
      fetchImpl,
    ),
  ]);
  await Promise.all([
    orgIdentityRegistrar.statusList.create({ now, validUntil: daysFrom(now, 400) }),
    beneficialOwnershipRegistrar.statusList.create({ now, validUntil: daysFrom(now, 400) }),
  ]);

  const validity = { validFrom: daysFrom(now, -60), validUntil: daysFrom(now, 305) };

  const orgIdentity = await issueCredential({
    claims: {
      address: NORTHWIND.homeAddress,
      businessName: NORTHWIND.businessName,
      kind: "org-identity-credential",
      legalForm: KYB.EntityLegalForm_LLC,
      lei: NORTHWIND.lei,
    },
    credentialId: `${podBase}kyb/credentials/org-identity`,
    issuer: orgIdentityRegistrar.webId,
    key: orgIdentityRegistrar.key,
    kind: "org-identity-credential",
    status: orgIdentityRegistrar.statusList.entry(1),
    subject: webid,
    validity,
  });

  const beneficialOwnership = await issueCredential({
    claims: {
      kind: "beneficial-ownership-credential",
      ownershipRecords: disclosedOwners.map((owner) => ({
        ownerName: owner.name,
        ownershipPercentage: owner.ownershipPercentage,
        ownershipPercentageBps: owner.ownershipPercentageBps,
      })),
    },
    credentialId: `${podBase}kyb/credentials/beneficial-ownership`,
    issuer: beneficialOwnershipRegistrar.webId,
    key: beneficialOwnershipRegistrar.key,
    kind: "beneficial-ownership-credential",
    status: beneficialOwnershipRegistrar.statusList.entry(2),
    subject: webid,
    validity,
  });

  const managingOfficer = disclosedOwners[0];
  if (managingOfficer === undefined)
    throw new Error("variant persona must have at least one owner");
  const officerAuthorization = await issueCredential({
    claims: {
      kind: "officer-authorization-credential",
      officer: { jobTitle: NORTHWIND.managingOfficerJobTitle, officerName: managingOfficer.name },
    },
    credentialId: `${podBase}kyb/credentials/officer-authorization`,
    issuer: orgIdentityRegistrar.webId,
    key: orgIdentityRegistrar.key,
    kind: "officer-authorization-credential",
    status: orgIdentityRegistrar.statusList.entry(3),
    subject: webid,
    validity,
  });

  const sampleAnchor = await issueCredential({
    claims: {
      field: KYB.ownershipPercentageBps,
      kind: "zk-operand-anchor",
      operandEnc: SAMPLE_OWNER_OPERAND_ENC,
    },
    credentialId: `${podBase}${ANCHOR_POD_PATHS.ownershipSample.slice(1)}`,
    issuer: beneficialOwnershipRegistrar.webId,
    key: beneficialOwnershipRegistrar.key,
    kind: "zk-operand-anchor",
    status: beneficialOwnershipRegistrar.statusList.entry(3),
    subject: webid,
    validity,
  });

  // The Tier B array-commitment anchor: the REAL TRUE (possibly hidden-owner) array,
  // computed entirely in JS — this is the genuinely honest anchor an issuer that
  // actually checked the full cap table would sign.
  const arrayCommitment = await ownershipArrayCommitment(options.trueOwnerBps);
  const arrayCommitmentAnchor = await issueCredential({
    claims: {
      field: KYB.beneficialOwnershipArrayCommitment,
      kind: "zk-operand-anchor",
      operandEnc: arrayCommitment,
    },
    credentialId: `${podBase}${ANCHOR_POD_PATHS.arrayCommitment.slice(1)}`,
    issuer: beneficialOwnershipRegistrar.webId,
    key: beneficialOwnershipRegistrar.key,
    kind: "zk-operand-anchor",
    status: beneficialOwnershipRegistrar.statusList.entry(4),
    subject: webid,
    validity,
  });

  const resources: readonly { path: string; body: string; contentType: string }[] = [
    {
      body: orgIdentityRegistrar.docBody,
      contentType: "text/turtle",
      path: "/kyb/issuers/org-identity",
    },
    {
      body: beneficialOwnershipRegistrar.docBody,
      contentType: "text/turtle",
      path: "/kyb/issuers/beneficial-ownership",
    },
    {
      body: orgIdentity.body,
      contentType: orgIdentity.contentType,
      path: "/kyb/credentials/org-identity",
    },
    {
      body: beneficialOwnership.body,
      contentType: beneficialOwnership.contentType,
      path: "/kyb/credentials/beneficial-ownership",
    },
    {
      body: officerAuthorization.body,
      contentType: officerAuthorization.contentType,
      path: "/kyb/credentials/officer-authorization",
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
    if (!response.ok)
      throw new Error(`variant seed PUT ${resource.path} failed: ${response.status}`);
  }

  const publicResources = ["/kyb/issuers/org-identity", "/kyb/issuers/beneficial-ownership"];
  for (const path of publicResources) {
    const resourceIri = `${podBase}${path.slice(1)}`;
    const aclResponse = await fetchImpl(`${resourceIri}.acl`, {
      body: publicReadAcl(resourceIri, webid),
      headers: { "content-type": "text/turtle", "if-none-match": "*" },
      method: "PUT",
    });
    if (!aclResponse.ok)
      throw new Error(`variant seed ACL PUT ${path}.acl failed: ${aclResponse.status}`);
  }
  const statusListResources = [
    STATUS_POD_PATHS.orgIdentityRegistrar,
    STATUS_POD_PATHS.beneficialOwnershipRegistrar,
  ];
  for (const path of statusListResources) {
    const resourceIri = `${podBase}${path.slice(1)}`;
    const aclResponse = await fetchImpl(`${resourceIri}.acl`, {
      body: publicReadAcl(resourceIri, webid),
      headers: { "content-type": "text/turtle", "if-none-match": "*" },
      method: "PUT",
    });
    if (!aclResponse.ok)
      throw new Error(`variant seed ACL PUT ${path}.acl failed: ${aclResponse.status}`);
  }

  const grantable = [
    "/kyb/credentials/org-identity",
    "/kyb/credentials/beneficial-ownership",
    "/kyb/credentials/officer-authorization",
    ANCHOR_POD_PATHS.ownershipSample,
    ANCHOR_POD_PATHS.arrayCommitment,
  ];
  for (const path of grantable) {
    const resourceIri = `${podBase}${path.slice(1)}`;
    const aclResponse = await fetchImpl(`${resourceIri}.acl`, {
      body: directGrantAcl(resourceIri, webid, [bankOnboardingServiceWebId]),
      headers: { "content-type": "text/turtle", "if-none-match": "*" },
      method: "PUT",
    });
    if (!aclResponse.ok)
      throw new Error(`variant seed ACL PUT ${path}.acl failed: ${aclResponse.status}`);
  }

  return {
    arrayCommitmentIri: `${podBase}${ANCHOR_POD_PATHS.arrayCommitment.slice(1)}`,
    beneficialOwnershipIri: `${podBase}kyb/credentials/beneficial-ownership`,
    beneficialOwnershipRegistrarWebId: beneficialOwnershipRegistrar.webId,
    officerAuthorizationIri: `${podBase}kyb/credentials/officer-authorization`,
    orgIdentityIri: `${podBase}kyb/credentials/org-identity`,
    orgIdentityRegistrarWebId: orgIdentityRegistrar.webId,
    sampleAnchorIri: `${podBase}${ANCHOR_POD_PATHS.ownershipSample.slice(1)}`,
  };
}

export { MIN_STATUS_LIST_LENGTH };
