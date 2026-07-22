/**
 * The security bar for verification: a genuinely issued credential is read
 * back from its pod-serialised bytes and verified against the REAL verifier +
 * SHACL + hosted status list; tampering, expiry, revocation, foreign keys,
 * decoy shapes and subject-binding mismatches ALL fail closed.
 */
import { DataFactory } from "n3";
import { expect, test } from "vitest";
import { verifyCredential } from "../src/index.ts";
import {
  DAY_MS,
  hostedStatusList,
  ISSUER,
  issueBeneficialOwnership,
  NOW,
  parseTurtle,
  resolveIssuerKey,
  stubHost,
  SUBJECT,
} from "./support.ts";

function verifyOptions(host: ReturnType<typeof stubHost>) {
  return {
    expectShape: "beneficial-ownership-credential" as const,
    now: NOW,
    resolveKey: resolveIssuerKey,
    statusFetch: host.fetch,
  };
}

test("round trip: issue, read back from bytes, verify against verifier + shape + status", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueBeneficialOwnership(list);

  const outcome = await verifyCredential(issued.body, verifyOptions(host));
  expect(outcome.errors).toEqual([]);
  expect(outcome.verified).toBe(true);
  // Subject binding: the verified projection exposes the business's own
  // WebID the relying app MUST match against the authenticated session.
  expect(outcome.credential?.subject).toBe(SUBJECT);
  expect(outcome.credential?.issuer).toBe(ISSUER);
});

test("a tampered claim (Jordan's stake inflated after signing) fails the signature gate", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueBeneficialOwnership(list);

  const tampered = parseTurtle(issued.body.replace("4200", "9600"));
  const outcome = await verifyCredential(tampered, verifyOptions(host));
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("INVALID_SIGNATURE");
});

test("an expired credential fails the window gate", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueBeneficialOwnership(list);

  const outcome = await verifyCredential(issued.body, {
    ...verifyOptions(host),
    now: new Date(NOW.getTime() + 320 * DAY_MS),
  });
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("EXPIRED");
});

test("a not-yet-valid credential fails the window gate", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueBeneficialOwnership(list);

  const outcome = await verifyCredential(issued.body, {
    ...verifyOptions(host),
    now: new Date(NOW.getTime() - 90 * DAY_MS),
  });
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("NOT_YET_VALID");
});

test("a revoked credential fails the status gate", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueBeneficialOwnership(list, 42);
  await list.revoke(42, { now: NOW });

  const outcome = await verifyCredential(issued.body, verifyOptions(host));
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("STATUS_REVOKED");
});

test("an unreachable status list is a FAILURE, never a pass", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueBeneficialOwnership(list);
  host.resources.clear(); // the hosted list vanishes

  const outcome = await verifyCredential(issued.body, verifyOptions(host));
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("STATUS_UNREACHABLE");
});

test("a key the issuer does not control fails the issuer-binding gate", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueBeneficialOwnership(list);

  const outcome = await verifyCredential(issued.body, {
    ...verifyOptions(host),
    isControlledBy: () => false,
  });
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("ISSUER_MISMATCH");
});

test("an unresolvable verification key fails the signature gate", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueBeneficialOwnership(list);

  const outcome = await verifyCredential(issued.body, {
    ...verifyOptions(host),
    resolveKey: async () => undefined,
  });
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("INVALID_SIGNATURE");
});

test("an issuer outside the allowlist is refused", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueBeneficialOwnership(list);

  const outcome = await verifyCredential(issued.body, {
    ...verifyOptions(host),
    trustedIssuers: ["https://issuers.example/orgs/org-identity-registrar#id"],
  });
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("UNTRUSTED_ISSUER");
});

test("the mandatory shape gate catches a wrong-kind document (no vacuous pass)", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueBeneficialOwnership(list);

  const outcome = await verifyCredential(issued.body, {
    ...verifyOptions(host),
    expectShape: "officer-authorization-credential",
  });
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("SHAPE_VIOLATION");
});

test("unsigned data smuggled onto the proof node is refused", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueBeneficialOwnership(list);

  const dataset = parseTurtle(issued.body);
  const proofQuads = [
    ...dataset.match(null, DataFactory.namedNode("https://w3id.org/security#proofValue"), null),
  ];
  expect(proofQuads.length).toBe(1);
  const proofNode = proofQuads[0]?.subject;
  if (proofNode === undefined) throw new Error("unreachable");
  dataset.add(
    DataFactory.quad(
      proofNode,
      DataFactory.namedNode("https://schema.org/comment"),
      DataFactory.literal("smuggled"),
    ),
  );
  const outcome = await verifyCredential(dataset, verifyOptions(host));
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("MALFORMED");
});

test("subject binding: a credential issued to a DIFFERENT WebID is detectable", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueBeneficialOwnership(list);

  const outcome = await verifyCredential(issued.body, verifyOptions(host));
  expect(outcome.verified).toBe(true);
  const presenter = "https://mallory.pod.example/profile/card#me";
  expect(outcome.credential?.subject).not.toBe(presenter);
});
