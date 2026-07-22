/**
 * Test-only issuance of the two credentials this desk reuses: a REAL, signed
 * org-identity credential and a REAL, signed beneficial-ownership credential
 * for Northwind Logistics LLC (`@kyb/data-model`'s `PERSONA_VALUES[0]`),
 * genuinely `eddsa-rdfc-2022`-signed through `@kyb/vc-kit`'s ordinary
 * `issueCredential` gate (SHACL before signature) — mirrors `apps/vault`'s
 * own `lib/server/kyb-issuance.ts` (an app-internal module, not importable
 * across app boundaries), trimmed to the two credentials this desk's
 * decision rail actually consumes and written as this app's OWN test-scoped
 * seeding helper.
 */
import { Buffer } from "node:buffer";
import {
  generateKeyPairForSuite,
  type IssuedCredential,
  issueCredential,
  type KeyPair,
  MIN_STATUS_LIST_LENGTH,
  publishVerificationMethod,
  StatusListClient,
} from "@kyb/vc-kit";
import { KYB, PERSONA_VALUES, RESOURCE_POD_PATHS } from "@kyb/data-model";
import { publicReadAcl } from "@kyb/test-kit";

const DAY_MS = 24 * 60 * 60 * 1000;

export const NORTHWIND: (typeof PERSONA_VALUES)[number] = (() => {
  const persona = PERSONA_VALUES[0];
  if (persona === undefined) throw new Error("PERSONA_VALUES must contain the Northwind persona");
  return persona;
})();

const ISSUER_DOC_PATH = "/kyb/issuers/test-issuer#id";
const STATUS_PATH = "/kyb/status/test-issuer";

export interface SeededCredentials {
  readonly issuerWebId: string;
  readonly issuerKey: KeyPair;
  readonly statusList: StatusListClient;
  readonly orgIdentity: IssuedCredential;
  readonly beneficialOwnership: IssuedCredential;
  readonly orgIdentityIndex: number;
  readonly beneficialOwnershipIndex: number;
}

/**
 * Issue + write BOTH credentials directly to `podBase` (via `fetchImpl` —
 * ordinarily the pod's own owner identity, which can write anywhere
 * regardless of whose WebID the credential is ABOUT) with `credentialSubject
 * = webid` (the business's own authenticated identity — holder binding).
 * One shared issuer identity + status list for both, published under the
 * SAME podBase so status/key resolution never leaves the test pod.
 */
export async function seedCddCredentials(options: {
  readonly podBase: string;
  readonly webid: string;
  readonly now: Date;
  readonly fetchImpl: typeof fetch;
  /** The pod owner's WebID — required by `publicReadAcl` (an ACL replaces the inherited one). */
  readonly ownerWebid: string;
}): Promise<SeededCredentials> {
  const { podBase, webid, now, fetchImpl, ownerWebid } = options;
  const issuerWebId = `${podBase}${ISSUER_DOC_PATH.slice(1)}`;
  const issuerKey = await generateKeyPairForSuite(`${issuerWebId}-key-1`, "Ed25519");
  const published = await publishVerificationMethod({ controller: issuerWebId, key: issuerKey });
  const statusUrl = `${podBase}${STATUS_PATH.slice(1)}`;
  const statusList = new StatusListClient({
    fetch: fetchImpl,
    issuer: issuerWebId,
    key: issuerKey,
    url: statusUrl,
  });
  await statusList.create({
    bits: Buffer.alloc(MIN_STATUS_LIST_LENGTH / 8),
    now,
    validUntil: new Date(now.getTime() + 400 * DAY_MS),
  });
  // The Bitstring status list is public-key-infrastructure material — real
  // PKI practice (and `verifyCredential`'s own default resolvers) expects an
  // issuer's public key document and revocation list to be world-readable,
  // independent of any grant scoping the CREDENTIALS themselves. Without
  // this, this desk's own resolveKey/status fetch (running over a PLAIN,
  // unauthenticated fetch — the same seam `verifyCredential`'s default
  // resolvers use) would be denied by the SAME `/kyb/` container ACL that
  // deliberately restricts the credentials to the granted service identity.
  const statusAclPut = await fetchImpl(`${statusUrl}.acl`, {
    body: publicReadAcl(STATUS_PATH, ownerWebid),
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    method: "PUT",
  });
  if (!statusAclPut.ok)
    throw new Error(`test issuer status ACL PUT failed: ${statusAclPut.status}`);

  const issuerDocPath = ISSUER_DOC_PATH.replace(/#id$/, "");
  const docPut = await fetchImpl(issuerWebId.split("#")[0] as string, {
    body: published.turtle,
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    method: "PUT",
  });
  if (!docPut.ok) throw new Error(`test issuer doc PUT failed: ${docPut.status}`);
  const docAclPut = await fetchImpl(`${podBase}${issuerDocPath.slice(1)}.acl`, {
    body: publicReadAcl(issuerDocPath, ownerWebid),
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    method: "PUT",
  });
  if (!docAclPut.ok) throw new Error(`test issuer doc ACL PUT failed: ${docAclPut.status}`);

  const validity = {
    validFrom: new Date(now.getTime() - 60 * DAY_MS),
    validUntil: new Date(now.getTime() + 305 * DAY_MS),
  };

  const orgIdentityIri = `${podBase}${RESOURCE_POD_PATHS["org-identity-credential"].slice(1)}`;
  const orgIdentityIndex = 1;
  const orgIdentity = await issueCredential({
    claims: {
      address: NORTHWIND.homeAddress,
      businessName: NORTHWIND.businessName,
      kind: "org-identity-credential",
      legalForm: KYB.EntityLegalForm_LLC,
      lei: NORTHWIND.lei,
    },
    credentialId: orgIdentityIri,
    issuer: issuerWebId,
    key: issuerKey,
    kind: "org-identity-credential",
    status: statusList.entry(orgIdentityIndex),
    subject: webid,
    validity,
  });
  const orgPut = await fetchImpl(orgIdentityIri, {
    body: orgIdentity.body,
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    method: "PUT",
  });
  if (!orgPut.ok) throw new Error(`org-identity credential PUT failed: ${orgPut.status}`);

  const beneficialOwnershipIri = `${podBase}${RESOURCE_POD_PATHS["beneficial-ownership-credential"].slice(1)}`;
  const beneficialOwnershipIndex = 2;
  const beneficialOwnership = await issueCredential({
    claims: {
      kind: "beneficial-ownership-credential",
      ownershipRecords: NORTHWIND.owners.map((owner) => ({
        ownerName: owner.name,
        ownershipPercentage: owner.ownershipPercentage,
        ownershipPercentageBps: owner.ownershipPercentageBps,
      })),
    },
    credentialId: beneficialOwnershipIri,
    issuer: issuerWebId,
    key: issuerKey,
    kind: "beneficial-ownership-credential",
    status: statusList.entry(beneficialOwnershipIndex),
    subject: webid,
    validity,
  });
  const boPut = await fetchImpl(beneficialOwnershipIri, {
    body: beneficialOwnership.body,
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    method: "PUT",
  });
  if (!boPut.ok) throw new Error(`beneficial-ownership credential PUT failed: ${boPut.status}`);

  return {
    beneficialOwnership,
    beneficialOwnershipIndex,
    issuerKey,
    issuerWebId,
    orgIdentity,
    orgIdentityIndex,
    statusList,
  };
}
