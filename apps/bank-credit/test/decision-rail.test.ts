/**
 * SECURITY-CRITICAL: the Business Credit Desk's reuse-and-decide rail
 * (design §5 scenes 3-4), driven end-to-end against REAL fixtures — a real
 * DPoP-bound Solid-OIDC caller session (`./support/caller-issuer.ts`), a
 * REAL WAC-enforcing `@jeswr/solid-server` pod seeded with genuinely signed
 * org-identity + beneficial-ownership credentials
 * (`./support/seed-credentials.ts`), and the route handler reached over an
 * ACTUAL HTTP round trip (`./support/route-server.ts`) so every credential
 * is transmitted, not hand-assembled. NOTHING here mocks authentication, the
 * pim:storage binding, WAC enforcement, or credential verification.
 *
 * Two DIFFERENT real Solid-OIDC identities are in play, deliberately
 * (mirrors `apps/vault`'s own `test/grant-rail.test.ts` and the
 * small-dollar-lending showcase's `apps/bank-lender/test/pod-auth.test.ts`,
 * jeswr/solid-lending, read-only reference):
 *   - `caller` — the BUSINESS's session (Northwind Logistics LLC), verified
 *     by `@jeswr/solid-pod-guard` (L1 DPoP-bound auth, L2 pim:storage
 *     binding);
 *   - `bankCreditAccount` (`pods.provisionAccount()`) — this desk's OWN
 *     service identity, the agent the business's WAC grant names. The pod
 *     itself enforces access against this identity's own authenticated
 *     fetch, exactly as it would in production behind
 *     `createServicePodFetch`.
 *
 * Acceptance (the sm-4f1z demo's "reuse, not re-collection" bar, played from
 * the second bank's seat):
 *   - anonymous callers are rejected (401 + WWW-Authenticate);
 *   - an unconfigured service identity fails closed (503) — never anonymous
 *     IO;
 *   - a service identity the grant does NOT name is denied by the pod's own
 *     WAC — no decision record written;
 *   - the honest case reads the SAME granted credentials, genuinely
 *     APPROVES, reuses the disclosed claims VERBATIM (no re-typing), and
 *     writes a real, SHACL-validated `kyb:CddDecisionRecord` (status
 *     "Opened") back into the business's pod;
 *   - revoking the org-identity credential's Bitstring status genuinely
 *     DECLINES — a real rejection, not a stub;
 *   - a credential signed by an UNTRUSTED issuer also genuinely DECLINES;
 *   - revoking the WAC grant itself genuinely shuts the read off (real
 *     WAC) — no further decision is possible.
 */
import { validate } from "@kyb/data-model";
import {
  generateKeyPairForSuite,
  issueCredential,
  type KeyPair,
  publishVerificationMethod,
} from "@kyb/vc-kit";
import { type SolidTestAccount, type SolidTestServer, startSolidServer } from "@kyb/test-kit";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { BankCreditConfig } from "../lib/server/config";
import {
  createDecisionRail,
  DECISION_POD_PATH,
  type DecisionRail,
} from "../lib/server/decision-rail";
import { createTestCallerIssuer, type TestCallerIssuer } from "./support/caller-issuer";
import { containerGrantAcl, ownerOnlyContainerAcl } from "./support/grant-acl";
import { serveHandler, type RouteServer } from "./support/route-server";
import { NORTHWIND, seedCddCredentials, type SeededCredentials } from "./support/seed-credentials";

const NOW = new Date("2026-07-22T12:00:00Z");

let pods: SolidTestServer;
let sparqOwner: SolidTestAccount;
let podBase = "";
let caller: TestCallerIssuer;
let bankCreditAccount: SolidTestAccount;
let seeded: SeededCredentials;
let config: BankCreditConfig;
let rail: DecisionRail;
let route: RouteServer;

function decisionUrl(): string {
  return `${podBase}${DECISION_POD_PATH.slice(1)}`;
}

async function grantKybContainer(agentWebid: string): Promise<void> {
  const response = await sparqOwner.authFetch(`${podBase}kyb/.acl`, {
    body: containerGrantAcl(`${podBase}kyb/`, { agentWebid, ownerWebid: sparqOwner.webid }),
    headers: { "content-type": "text/turtle" },
    method: "PUT",
  });
  if (!response.ok) throw new Error(`kyb container grant ACL PUT failed: ${response.status}`);
}

async function revokeKybContainer(): Promise<void> {
  const response = await sparqOwner.authFetch(`${podBase}kyb/.acl`, {
    body: ownerOnlyContainerAcl(`${podBase}kyb/`, sparqOwner.webid),
    headers: { "content-type": "text/turtle" },
    method: "PUT",
  });
  if (!response.ok) throw new Error(`kyb container revoke ACL PUT failed: ${response.status}`);
}

beforeAll(async () => {
  pods = await startSolidServer({ oidc: true });
  const primary = pods.accounts[0];
  if (primary === undefined) throw new Error("OIDC harness did not provision an owner");
  sparqOwner = primary;
  podBase = `${sparqOwner.baseUrl}/`;

  caller = await createTestCallerIssuer();
  caller.setStorage(podBase);

  // Backward acknowledgment (L2.3): the pod's owner-only-writable profile card names the
  // CALLER (Northwind's real-world identity) — publicly readable, mirrors apps/vault's own
  // test/grant-rail.test.ts.
  const profilePut = await sparqOwner.authFetch(`${podBase}profile/card`, {
    body: `@prefix pim: <http://www.w3.org/ns/pim/space#> .
<${caller.webid}> pim:storage <${podBase}> .
`,
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    method: "PUT",
  });
  if (!profilePut.ok) throw new Error(`could not seed profile card: ${profilePut.status}`);
  const profileAcl = await sparqOwner.authFetch(`${podBase}profile/card.acl`, {
    body: `@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<#public> a acl:Authorization ; acl:accessTo <${podBase}profile/card> ; acl:agentClass foaf:Agent ; acl:mode acl:Read .
<#owner> a acl:Authorization ; acl:accessTo <${podBase}profile/card> ; acl:agent <${sparqOwner.webid}> ; acl:mode acl:Read, acl:Write, acl:Control .
`,
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    method: "PUT",
  });
  if (!profileAcl.ok) throw new Error(`could not lock profile card acl: ${profileAcl.status}`);

  // Seed the two REAL signed credentials, subject-bound to the CALLER, written through the
  // pod's own native owner identity (the SAME split solid-lending's seeds use: who a
  // credential is ABOUT is independent of who has write access to store it).
  seeded = await seedCddCredentials({
    fetchImpl: sparqOwner.authFetch,
    now: NOW,
    ownerWebid: sparqOwner.webid,
    podBase,
    webid: caller.webid,
  });

  bankCreditAccount = await pods.provisionAccount();
  await grantKybContainer(bankCreditAccount.webid);

  config = {
    allowedPodOrigins: [pods.baseUrl],
    allowInsecureLoopback: true,
    bankCreditWebId: "https://bank-credit.example/orgs/business-credit-desk#id",
    podServiceClientId: undefined,
    podServiceClientSecret: undefined,
    podServiceIssuer: undefined,
    serviceWebId: bankCreditAccount.webid,
    trustedCredentialIssuers: [seeded.issuerWebId],
    trustedOidcIssuers: [caller.origin],
    trustForwardedHeaders: false,
  };
  rail = createDecisionRail({
    config,
    now: () => NOW,
    podFetch: bankCreditAccount.authFetch,
    publicRequestUrl: (request) => request.url,
    serviceWebId: bankCreditAccount.webid,
  });
  route = await serveHandler((request) => rail.decide(request));
}, 120_000);

afterAll(async () => {
  await route?.stop();
  await caller?.close();
  await pods?.stop();
});

describe("boundary rejections", () => {
  test("anonymous callers get 401 + WWW-Authenticate", async () => {
    const response = await fetch(route.url, { method: "POST" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).not.toBeNull();
  });

  test("an unconfigured service identity fails closed (503) — never anonymous IO", async () => {
    const unconfigured = createDecisionRail({
      config: { ...config, podServiceClientSecret: undefined, serviceWebId: undefined },
      now: () => NOW,
      publicRequestUrl: (request) => request.url,
    });
    const localRoute = await serveHandler((request) => unconfigured.decide(request));
    try {
      const response = await caller.fetch(localRoute.url, { method: "POST" });
      expect(response.status).toBe(503);
    } finally {
      await localRoute.stop();
    }
  });
});

describe("the grant boundary is the pod's own WAC", () => {
  test("a service identity the grant does not name is denied by the pod — no decision written", async () => {
    const rogueAccount = await pods.provisionAccount();
    const rogue = createDecisionRail({
      config: { ...config, serviceWebId: rogueAccount.webid },
      now: () => NOW,
      podFetch: rogueAccount.authFetch,
      publicRequestUrl: (request) => request.url,
      serviceWebId: rogueAccount.webid,
    });
    const localRoute = await serveHandler((request) => rogue.decide(request));
    try {
      const response = await caller.fetch(localRoute.url, { method: "POST" });
      expect(response.ok).toBe(false);
      expect([401, 403]).toContain(response.status);
      const decisionRead = await sparqOwner.authFetch(decisionUrl());
      expect(decisionRead.status).toBe(404);
    } finally {
      await localRoute.stop();
    }
  }, 60_000);
});

describe("the honest case — real grant read, real verify, real reuse", () => {
  test("decide: approves, reuses the disclosed claims verbatim, writes an Opened CDD decision record", async () => {
    const response = await caller.fetch(route.url, { method: "POST" });
    expect(response.status, await response.clone().text()).toBe(200);
    const report = (await response.json()) as {
      decision: { outcome: string; findings: { code: string; pass: boolean }[]; reasons: string[] };
      claims: { businessName: string; lei: string; owners: { ownerName: string }[] } | null;
      decisionIri: string;
    };

    expect(report.decision.outcome).toBe("approve");
    expect(report.decision.reasons).toHaveLength(0);
    expect(report.decision.findings.every((finding) => finding.pass)).toBe(true);

    // Reused, not re-collected: the SAME disclosed values, byte-identical to the persona.
    expect(report.claims?.businessName).toBe(NORTHWIND.businessName);
    expect(report.claims?.lei).toBe(NORTHWIND.lei);
    expect(report.claims?.owners.map((owner) => owner.ownerName).sort()).toEqual(
      NORTHWIND.owners.map((owner) => owner.name).sort(),
    );

    expect(report.decisionIri).toBe(decisionUrl());
    const written = await sparqOwner.authFetch(decisionUrl(), {
      headers: { accept: "text/turtle" },
    });
    expect(written.status).toBe(200);
    const turtle = await written.text();
    expect(turtle).toContain("CddDecisionStatus-Opened");
    expect(turtle).toContain(seeded.orgIdentity.credentialId);
    expect(turtle).toContain(seeded.beneficialOwnership.credentialId);

    const shapeReport = await validate(turtle, {
      baseIRI: decisionUrl(),
      expect: "cdd-decision-record",
      focusNode: decisionUrl(),
    });
    expect(shapeReport.conforms, JSON.stringify(shapeReport.violations)).toBe(true);

    // Not public: only the granted service identity (and the owner) can read it.
    const anonymous = await fetch(decisionUrl());
    expect(anonymous.ok).toBe(false);
  }, 60_000);
});

describe("a revoked credential genuinely declines — real rejection, not a stub", () => {
  test("revoking the org-identity credential's Bitstring status makes the SAME route decline", async () => {
    await seeded.statusList.revoke(seeded.orgIdentityIndex, { now: NOW });

    const response = await caller.fetch(route.url, { method: "POST" });
    expect(response.status).toBe(200);
    const report = (await response.json()) as {
      decision: {
        outcome: string;
        reasons: string[];
        findings: { code: string; pass: boolean; observed: string }[];
      };
    };
    expect(report.decision.outcome).toBe("decline");
    expect(report.decision.reasons).toContain(
      "organisational-identity credential could not be confirmed",
    );
    const finding = report.decision.findings.find((f) => f.code === "EVIDENCE_ORG_IDENTITY");
    expect(finding?.pass).toBe(false);

    const written = await sparqOwner.authFetch(decisionUrl(), {
      headers: { accept: "text/turtle" },
    });
    const turtle = await written.text();
    expect(turtle).toContain("CddDecisionStatus-Declined");
  }, 60_000);
});

describe("a credential from an UNTRUSTED issuer genuinely declines", () => {
  test("swapping in an untrusted-issuer beneficial-ownership credential declines, even though the org-identity credential is still revoked from the prior test", async () => {
    // Reinstate the org-identity credential's status first, isolating this test's signal to
    // the issuer-trust gate on the OTHER credential.
    await seeded.statusList.reinstate(seeded.orgIdentityIndex, { now: NOW });

    const rogueKey: KeyPair = await generateKeyPairForSuite(
      "https://rogue.example/issuer#key-1",
      "Ed25519",
    );
    await publishVerificationMethod({ controller: "https://rogue.example/issuer", key: rogueKey });
    const boIri = `${podBase}${"kyb/credentials/beneficial-ownership"}`;
    const rogueCredential = await issueCredential({
      claims: {
        kind: "beneficial-ownership-credential",
        ownershipRecords: NORTHWIND.owners.map((owner) => ({
          ownerName: owner.name,
          ownershipPercentage: owner.ownershipPercentage,
          ownershipPercentageBps: owner.ownershipPercentageBps,
        })),
      },
      credentialId: boIri,
      issuer: "https://rogue.example/issuer",
      key: rogueKey,
      kind: "beneficial-ownership-credential",
      status: {
        id: "https://rogue.example/status/beneficial-ownership#0",
        statusListCredential: "https://rogue.example/status/beneficial-ownership",
        statusListIndex: 0,
        statusPurpose: "revocation",
      },
      subject: caller.webid,
      validity: { validFrom: NOW, validUntil: new Date(NOW.getTime() + 60 * 24 * 3600 * 1000) },
    });
    const put = await sparqOwner.authFetch(boIri, {
      body: rogueCredential.body,
      headers: { "content-type": "text/turtle" },
      method: "PUT",
    });
    expect(put.ok).toBe(true);

    const response = await caller.fetch(route.url, { method: "POST" });
    expect(response.status).toBe(200);
    const report = (await response.json()) as { decision: { outcome: string; reasons: string[] } };
    expect(report.decision.outcome).toBe("decline");
    expect(report.decision.reasons).toContain(
      "beneficial-ownership disclosure could not be confirmed",
    );
  }, 60_000);
});

describe("revocation genuinely shuts the read off (real WAC)", () => {
  test("after the business revokes the /kyb/ grant, the service identity is denied by the pod", async () => {
    await revokeKybContainer();
    const response = await caller.fetch(route.url, { method: "POST" });
    expect(response.ok).toBe(false);
    expect([401, 403]).toContain(response.status);

    // The pod itself still serves its owner (revocation removed one agent, not the data).
    const ownerRead = await sparqOwner.authFetch(`${podBase}kyb/credentials/org-identity`);
    expect(ownerRead.status).toBe(200);
  }, 60_000);
});
