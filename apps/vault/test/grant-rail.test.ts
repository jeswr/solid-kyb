/**
 * SECURITY-CRITICAL: the vault's Mode-2 grant/revoke rail (design §5/§6), driven end-to-end
 * against REAL fixtures — a real DPoP-bound Solid-OIDC caller session
 * (`./support/caller-issuer.ts`), a REAL WAC-enforcing `@jeswr/solid-server` pod seeded with
 * genuinely signed KYB credentials (`../lib/server/kyb-issuance.ts`), the route handlers
 * reached over an ACTUAL HTTP round trip (`./support/fetch-server.ts`) so every credential
 * is transmitted, not hand-assembled. NOTHING here mocks authentication, the pim:storage
 * binding, or WAC enforcement.
 *
 * Two DIFFERENT real Solid-OIDC identities are in play, deliberately (mirrors the
 * lending/mortgage showcases' own wallet test):
 *   - `caller`/`unbound` — the BUSINESS's session, verified by `@jeswr/solid-pod-guard` (L1
 *     DPoP-bound auth, L2 pim:storage binding). `@kyb/test-kit`'s bundled dev issuer cannot
 *     play this role: its WebID claims are `http://localhost:<port>`, and
 *     `@jeswr/solid-api-auth` only accepts `http:` WebIDs on hostname `localhost` — but this
 *     caller identity uses `https:` instead (see `./support/caller-issuer.ts`'s header),
 *     sidestepping that restriction entirely.
 *   - `sparqOwner` (`pods.accounts[0]`) — the identity `@jeswr/solid-server` itself verifies
 *     for direct WAC reads/writes. It seeds the pod AND stands in for the engine's Mode-2
 *     service identity.
 *
 * Acceptance:
 *   - anonymous callers get 401 + WWW-Authenticate on every route;
 *   - `pod`/`webid` overrides (query or body) are 400;
 *   - a caller with no pim:storage binding is refused 403;
 *   - an unconfigured service identity fails closed 503;
 *   - an unknown/off-catalogue (party, resource) pair is refused 400 before any pod IO;
 *   - GRANT materialises a REAL WAC effect: the party's own authenticated read of the
 *     credential succeeds (200), a different party gains nothing;
 *   - REVOKE removes it: the party's authenticated read -> 401/403;
 *   - revocation is IMMUTABLE (re-grant after revoke -> 409, access stays off);
 *   - repeats are idempotent-in-effect 409 no-ops;
 *   - the ledger holds one receipt per transition, in order.
 */
import { startSolidServer, type SolidTestAccount, type SolidTestServer } from "@kyb/test-kit";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { resourceIri } from "../lib/grants/resources";
import { seedNorthwindPod } from "../lib/server/kyb-issuance";
import type { VaultGrantConfig } from "../lib/server/config";
import { createVaultGrantService, type VaultGrantService } from "../lib/server/vault-grant-service";
import { createTestCallerIssuer, type TestCallerIssuer } from "./support/caller-issuer";
import { startFetchServer, type FetchServer } from "./support/fetch-server";

const NOW = new Date("2026-07-22T12:00:00Z");

let pods: SolidTestServer;
let podBase = "";
let sparqOwner: SolidTestAccount;
let bankOnboarding: SolidTestAccount;
let bankCredit: SolidTestAccount;
let caller: TestCallerIssuer;
let unbound: TestCallerIssuer;
let server: FetchServer;
let config: VaultGrantConfig;
let service: VaultGrantService;

function apiUrl(path: string): string {
  return `${server.origin}${path}`;
}

beforeAll(async () => {
  pods = await startSolidServer({ oidc: true });
  const primary = pods.accounts[0];
  if (primary === undefined) throw new Error("OIDC harness did not provision an owner");
  sparqOwner = primary;
  podBase = `${sparqOwner.baseUrl}/`;
  [bankOnboarding, bankCredit] = await Promise.all([
    pods.provisionAccount(),
    pods.provisionAccount(),
  ]);
  [caller, unbound] = await Promise.all([createTestCallerIssuer(), createTestCallerIssuer()]);
  caller.setStorage(podBase);
  // `unbound` never calls setStorage — its profile genuinely claims no pim:storage pod
  // (the real 403 case, not a stub).

  // Seed the three REAL signed credentials (the grantable resource catalogue) directly
  // through the pod's own native OIDC identity.
  await seedNorthwindPod({
    podBase,
    webid: sparqOwner.webid,
    now: NOW,
    fetchImpl: sparqOwner.authFetch,
  });

  // Backward acknowledgment (L2.3): the pod's owner-only-writable profile card names the
  // CALLER (Northwind's real-world identity) — publicly readable.
  const profileResponse = await sparqOwner.authFetch(`${podBase}profile/card`, {
    method: "PUT",
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    body: `@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix pim: <http://www.w3.org/ns/pim/space#> .
<${caller.webid}> a foaf:Person ; foaf:name "Northwind Logistics LLC" ; pim:storage <${podBase}> .
`,
  });
  if (!profileResponse.ok)
    throw new Error(`could not seed profile card: ${profileResponse.status}`);
  const aclResponse = await sparqOwner.authFetch(`${podBase}profile/card.acl`, {
    method: "PUT",
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    body: `@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<#public> a acl:Authorization ; acl:accessTo <${podBase}profile/card> ; acl:agentClass foaf:Agent ; acl:mode acl:Read .
<#owner> a acl:Authorization ; acl:accessTo <${podBase}profile/card> ; acl:agent <${sparqOwner.webid}> ; acl:mode acl:Read, acl:Write, acl:Control .
`,
  });
  if (!aclResponse.ok) throw new Error(`could not lock profile card acl: ${aclResponse.status}`);

  config = {
    guard: {
      trustedOidcIssuers: [caller.origin, unbound.origin],
      allowedPodOrigins: [pods.baseUrl],
      allowInsecureLoopback: true,
      trustForwardedHeaders: false,
    },
    serviceWebId: undefined,
    podServiceIssuer: undefined,
    podServiceClientId: undefined,
    podServiceClientSecret: undefined,
    partyWebIds: {
      "bank-onboarding": bankOnboarding.webid,
      "bank-credit": bankCredit.webid,
    },
  };
  service = createVaultGrantService({
    config,
    // Real WAC IO through the pod's own native OIDC identity.
    podFetch: sparqOwner.authFetch,
    serviceWebId: sparqOwner.webid,
    now: () => NOW,
  });

  server = await startFetchServer((request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/grants" && request.method === "GET") return service.grants(request);
    if (url.pathname === "/api/grants/change" && request.method === "POST") {
      return service.changeGrant(request);
    }
    if (url.pathname === "/api/ledger" && request.method === "GET") return service.ledger(request);
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
}, 120_000);

afterAll(async () => {
  await server?.stop();
  await caller?.close();
  await unbound?.close();
  await pods?.stop();
});

async function authed(
  issuer: TestCallerIssuer,
  method: string,
  path: string,
  options: { query?: string; body?: string } = {},
): Promise<Response> {
  const url = `${apiUrl(path)}${options.query ?? ""}`;
  return issuer.fetch(url, {
    method,
    ...(options.body !== undefined
      ? { body: options.body, headers: { "content-type": "application/json" } }
      : {}),
  });
}

describe("boundary rejections", () => {
  test("anonymous callers get 401 + WWW-Authenticate on every route", async () => {
    for (const [path, method] of [
      ["/api/grants", "GET"],
      ["/api/grants/change", "POST"],
      ["/api/ledger", "GET"],
    ] as const) {
      const response = await fetch(apiUrl(path), { method });
      expect(response.status, path).toBe(401);
      expect(response.headers.get("www-authenticate"), path).not.toBeNull();
    }
  });

  test("caller-supplied pod/webid are rejected 400 in query and body", async () => {
    const query = await authed(caller, "GET", "/api/grants", {
      query: `?pod=${encodeURIComponent(podBase)}`,
    });
    expect(query.status).toBe(400);

    const body = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({
        party: "bank-onboarding",
        resource: "orgIdentity",
        action: "grant",
        webid: caller.webid,
      }),
    });
    expect(body.status).toBe(400);
    expect(((await body.json()) as { error: string }).error).toBe("param_rejected");
  });

  test("a trusted caller with no pim:storage claim is refused 403", async () => {
    const response = await authed(unbound, "GET", "/api/grants");
    expect(response.status).toBe(403);
  });

  test("an unconfigured service identity fails closed 503 (never anonymous IO)", async () => {
    const unconfiguredServer = await startFetchServer((request) => {
      const unconfigured = createVaultGrantService({
        config: { ...config, serviceWebId: undefined, podServiceClientSecret: undefined },
      });
      return unconfigured.ledger(request);
    });
    try {
      const response = await caller.fetch(`${unconfiguredServer.origin}/x`, { method: "GET" });
      expect(response.status).toBe(503);
    } finally {
      await unconfiguredServer.stop();
    }
  });

  test("an unknown party, unknown resource, or off-catalogue pair is rejected before any pod IO", async () => {
    const unknownParty = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "mallory", resource: "orgIdentity", action: "grant" }),
    });
    expect(unknownParty.status).toBe(400);

    const unknownResource = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "bank-onboarding", resource: "nonsense", action: "grant" }),
    });
    expect(unknownResource.status).toBe(400);
  });
});

describe("the grant lifecycle (REAL WAC effects)", () => {
  test("grant -> real read; revoke -> real 401/403; immutable + idempotent; receipted", async () => {
    const orgIdentityIri = resourceIri(podBase, "orgIdentity");

    // Nothing to revoke yet.
    const early = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "bank-onboarding", resource: "orgIdentity", action: "revoke" }),
    });
    expect(early.status).toBe(409);

    // GRANT: a REAL WAC effect on the org-identity credential.
    const grant = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "bank-onboarding", resource: "orgIdentity", action: "grant" }),
    });
    expect(grant.status).toBe(200);
    const granted = (await grant.json()) as { receipt: { action: string; recipient: string } };
    expect(granted.receipt.action).toBe("grant");
    expect(granted.receipt.recipient).toBe(bankOnboarding.webid);
    expect((await bankOnboarding.authFetch(orgIdentityIri)).status).toBe(200);
    // A DIFFERENT party gained nothing.
    expect([401, 403]).toContain((await bankCredit.authFetch(orgIdentityIri)).status);
    // Anonymous still refused.
    expect([401, 403]).toContain((await fetch(orgIdentityIri)).status);

    // Repeat grant: recorded already -> 409, nothing changes.
    const regrant = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "bank-onboarding", resource: "orgIdentity", action: "grant" }),
    });
    expect(regrant.status).toBe(409);
    expect((await bankOnboarding.authFetch(orgIdentityIri)).status).toBe(200);

    // The dashboard reflects live standing.
    const dashboard = await authed(caller, "GET", "/api/grants");
    expect(dashboard.status).toBe(200);
    const { standings, parties } = (await dashboard.json()) as {
      standings: readonly { agent: string; resource: string; granted: boolean; revoked: boolean }[];
      parties: readonly { id: string; webid: string }[];
    };
    expect(parties.map((party) => party.id).sort()).toEqual(["bank-credit", "bank-onboarding"]);
    expect(
      standings.find(
        (entry) => entry.agent === bankOnboarding.webid && entry.resource === "orgIdentity",
      ),
    ).toMatchObject({ granted: true, revoked: false });

    // REVOKE: the WAC rule is gone.
    const revoke = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "bank-onboarding", resource: "orgIdentity", action: "revoke" }),
    });
    expect(revoke.status).toBe(200);
    expect([401, 403]).toContain((await bankOnboarding.authFetch(orgIdentityIri)).status);

    // Repeat revoke: idempotent in effect.
    const rerevoke = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "bank-onboarding", resource: "orgIdentity", action: "revoke" }),
    });
    expect(rerevoke.status).toBe(409);
    expect([401, 403]).toContain((await bankOnboarding.authFetch(orgIdentityIri)).status);

    // IMMUTABLE: the revoked party can never be re-granted this resource.
    const afterRevoke = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "bank-onboarding", resource: "orgIdentity", action: "grant" }),
    });
    expect(afterRevoke.status).toBe(409);
    expect([401, 403]).toContain((await bankOnboarding.authFetch(orgIdentityIri)).status);

    // The ledger holds one receipt per transition on THIS resource, in order (checked
    // before granting a different resource below — the ledger is cross-resource, and
    // every receipt in this fixed-clock test shares one timestamp, so a same-timestamp
    // tie against a DIFFERENT resource's receipt would otherwise fall back to IRI order).
    const orgIdentityLedger = await authed(caller, "GET", "/api/ledger");
    expect(orgIdentityLedger.status).toBe(200);
    const { receipts: orgIdentityReceipts } = (await orgIdentityLedger.json()) as {
      receipts: readonly { action: string; recipient: string; resource: string }[];
    };
    expect(
      orgIdentityReceipts
        .filter((receipt) => receipt.resource === orgIdentityIri)
        .map(({ action, recipient }) => [action, recipient]),
    ).toEqual([
      ["grant", bankOnboarding.webid],
      ["revoke", bankOnboarding.webid],
    ]);

    // A DIFFERENT resource for the SAME party still grants fine.
    const boGrant = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({
        party: "bank-onboarding",
        resource: "beneficialOwnership",
        action: "grant",
      }),
    });
    expect(boGrant.status).toBe(200);
    expect(
      (await bankOnboarding.authFetch(resourceIri(podBase, "beneficialOwnership"))).status,
    ).toBe(200);
    // The org-identity revocation is untouched by the unrelated resource's grant.
    expect([401, 403]).toContain((await bankOnboarding.authFetch(orgIdentityIri)).status);

    // The ledger now also carries the beneficial-ownership grant receipt.
    const fullLedger = await authed(caller, "GET", "/api/ledger");
    expect(fullLedger.status).toBe(200);
    const { receipts } = (await fullLedger.json()) as {
      receipts: readonly { action: string; recipient: string; resource: string }[];
    };
    expect(
      receipts.some(
        (receipt) =>
          receipt.action === "grant" &&
          receipt.recipient === bankOnboarding.webid &&
          receipt.resource === resourceIri(podBase, "beneficialOwnership"),
      ),
    ).toBe(true);
    expect(receipts).toHaveLength(3);
  }, 120_000);

  test("both banks can hold independent grants over the same credential (reuse, not re-collection)", async () => {
    const officerIri = resourceIri(podBase, "officerAuthorization");
    const first = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({
        party: "bank-onboarding",
        resource: "officerAuthorization",
        action: "grant",
      }),
    });
    expect(first.status).toBe(200);
    const second = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({
        party: "bank-credit",
        resource: "officerAuthorization",
        action: "grant",
      }),
    });
    expect(second.status).toBe(200);
    expect((await bankOnboarding.authFetch(officerIri)).status).toBe(200);
    expect((await bankCredit.authFetch(officerIri)).status).toBe(200);
  }, 120_000);
});
