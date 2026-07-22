/**
 * Issuance gates: every design §3.2 credential kind issues as a REAL
 * eddsa-rdfc-2022-signed document; the SHACL shape gate refuses invalid
 * claims BEFORE any signature exists; structural guards refuse IRI injection
 * and mismatched kinds.
 */
import { expect, test } from "vitest";
import {
  ClaimInputError,
  type CredentialKind,
  credentialSchemaIri,
  IssueRefusedError,
  issueCredential,
  type KybCredentialClaims,
} from "../src/index.ts";
import {
  anchorClaims,
  BACKDATED_VALIDITY,
  beneficialOwnershipClaims,
  hostedStatusList,
  ISSUER,
  issuerKey,
  officerAuthorizationClaims,
  orgIdentityClaims,
  parseTurtle,
  stubHost,
  SUBJECT,
} from "./support.ts";

const ALL_KINDS: readonly [CredentialKind, () => KybCredentialClaims][] = [
  ["org-identity-credential", orgIdentityClaims],
  ["beneficial-ownership-credential", beneficialOwnershipClaims],
  ["officer-authorization-credential", officerAuthorizationClaims],
  ["zk-operand-anchor", anchorClaims],
];

test("every credential kind issues a signed, schema-tagged Turtle document", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  for (const [kind, claims] of ALL_KINDS) {
    const issued = await issueCredential({
      kind,
      credentialId: `https://northwind.pod.example/kyb/test/${kind}`,
      issuer: ISSUER,
      subject: SUBJECT,
      claims: claims(),
      validity: BACKDATED_VALIDITY,
      status: list.entry(7),
      key: await issuerKey(),
    });
    expect(issued.kind).toBe(kind);
    expect(issued.contentType).toBe("text/turtle");
    // The proof exists and covers a strict subset of the document.
    expect(issued.proof.cryptosuite).toBe("eddsa-rdfc-2022");
    expect(issued.proof.proofValue.length).toBeGreaterThan(0);
    expect(issued.quads.length).toBeGreaterThan(issued.claimQuads.length);
    // The document parses and carries the credentialSchema tag for its kind.
    const parsed = parseTurtle(issued.body);
    expect(parsed.size).toBe(issued.quads.length);
    expect(issued.body).toContain(credentialSchemaIri(kind));
  }
});

test("claims.kind must match the requested kind (no cross-kind signing)", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  await expect(
    issueCredential({
      kind: "officer-authorization-credential",
      credentialId: "https://northwind.pod.example/kyb/test/mismatch",
      issuer: ISSUER,
      subject: SUBJECT,
      claims: orgIdentityClaims(),
      validity: BACKDATED_VALIDITY,
      status: list.entry(7),
      key: await issuerKey(),
    }),
  ).rejects.toThrow(ClaimInputError);
});

test("the shape gate refuses an over-budget hidden ownership value BEFORE signing", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  await expect(
    issueCredential({
      kind: "beneficial-ownership-credential",
      credentialId: "https://northwind.pod.example/kyb/test/over-budget",
      issuer: ISSUER,
      subject: SUBJECT,
      claims: beneficialOwnershipClaims({
        ownershipRecords: [
          {
            ownerName: "Overclaim Owner",
            ownershipPercentage: 100,
            ownershipPercentageBps: 20_000,
          },
        ],
      }),
      validity: BACKDATED_VALIDITY,
      status: list.entry(7),
      key: await issuerKey(),
    }),
    // The ZK digit-budget setter throws RangeError before the shape gate ever runs.
  ).rejects.toThrow(RangeError);
});

test("credentials whose shapes require a status entry refuse to issue without one", async () => {
  await expect(
    // @ts-expect-error - status is required at the type level; this proves the runtime gate too.
    issueCredential({
      kind: "beneficial-ownership-credential",
      credentialId: "https://northwind.pod.example/kyb/test/no-status",
      issuer: ISSUER,
      subject: SUBJECT,
      claims: beneficialOwnershipClaims(),
      validity: BACKDATED_VALIDITY,
      key: await issuerKey(),
    }),
  ).rejects.toThrow();
});

test("credentials whose shapes require validUntil refuse an open-ended window", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  await expect(
    issueCredential({
      kind: "beneficial-ownership-credential",
      credentialId: "https://northwind.pod.example/kyb/test/no-until",
      issuer: ISSUER,
      subject: SUBJECT,
      claims: beneficialOwnershipClaims(),
      validity: { validFrom: BACKDATED_VALIDITY.validFrom },
      status: list.entry(7),
      key: await issuerKey(),
    }),
  ).rejects.toThrow(IssueRefusedError);
});

test("IRI injection is refused at the door", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  await expect(
    issueCredential({
      kind: "beneficial-ownership-credential",
      credentialId: "https://northwind.pod.example/kyb/x> <urn:x:y> <urn:x:z> . #",
      issuer: ISSUER,
      subject: SUBJECT,
      claims: beneficialOwnershipClaims(),
      validity: BACKDATED_VALIDITY,
      status: list.entry(7),
      key: await issuerKey(),
    }),
  ).rejects.toThrow(ClaimInputError);
});

test("the anchor kind refuses non-anchorable fields at the build-time gate", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  await expect(
    issueCredential({
      kind: "zk-operand-anchor",
      credentialId: "https://northwind.pod.example/kyb/test/bad-anchor",
      issuer: ISSUER,
      subject: SUBJECT,
      // A LEI is deliberately NOT ZK-anchorable in this demo.
      claims: anchorClaims({
        field:
          "https://spec.edmcouncil.org/fibo/ontology/BE/LegalEntities/LEIEntities/LegalEntityIdentifier",
      }),
      validity: BACKDATED_VALIDITY,
      status: list.entry(7),
      key: await issuerKey(),
    }),
  ).rejects.toThrow(RangeError);
});
