/**
 * SECURITY-CRITICAL: the bank-onboarding rail (design §3/§4/§5 scene 2),
 * exercised end-to-end against REAL fixtures — a REAL DPoP-bound Solid-OIDC
 * business caller (`./support/caller-issuer.ts`), a REAL WAC-enforcing
 * `@jeswr/solid-server` pod (`@kyb/test-kit`) seeded with genuinely signed
 * KYB credentials AND real ZK operand anchors (`./support/seed.ts`), the
 * route handlers reached over an ACTUAL HTTP round trip
 * (`./support/fetch-server.ts`), and GENUINE `@kyb/vc-kit` UltraHonk proofs
 * (`proveOwnerThreshold`/`proveCompleteness`) verified by this app's OWN
 * `verifyOwnerThreshold`/`verifyCompleteness` calls. NOTHING on the
 * credential-verification or ZK-verification path is mocked.
 *
 * Acceptance:
 *  - the honest Northwind case, with genuinely produced Tier A + Tier B
 *    proofs against the REAL pod-resident anchors, APPROVES (status
 *    "opened");
 *  - a byte-tampered Tier B proof DECLINES — a real `PROOF_INVALID`
 *    rejection from the real UltraHonk verifier, not an asserted mock;
 *  - a REPLAYED proof (the exact same challenge/proof submitted twice)
 *    DECLINES on the second submission — the nonce is burned on first use;
 *  - a beneficial-ownership registrar that anchors a TRUE owner array
 *    hiding a >= 25% owner the disclosed credential does not show DECLINES:
 *    the honest completeness proof (produced over the TRUE array, and
 *    therefore carrying the TRUE disclosed-count public input) fails this
 *    app's own cross-check against the count it computes from the
 *    DISCLOSED credential — `STATEMENT_MISMATCH`, a real rejection driven
 *    by real data, never a mock;
 *  - separately, `proveCompleteness` itself REFUSES to produce a proof at
 *    all for a dishonestly UNDERSTATED disclosed count over that same
 *    hidden-owner array (`UNSATISFIABLE`) — the ZK layer's own forgery-
 *    proofing, exercised directly.
 */
import {
  ownershipArrayCommitment,
  proveCompleteness,
  proveOwnerThreshold,
  type TierAProof,
} from "@kyb/vc-kit";
import { type SolidTestAccount, type SolidTestServer, startSolidServer } from "@kyb/test-kit";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createOnboardingService, type OnboardingService } from "../lib/server/onboarding-rail";
import { createTestCallerIssuer, type TestCallerIssuer } from "./support/caller-issuer";
import { startFetchServer, type FetchServer } from "./support/fetch-server";
import {
  NORTHWIND,
  SAMPLE_OWNER_BPS,
  SAMPLE_OWNER_OPERAND_ENC,
  seedOnboardingPod,
} from "./support/seed";

const NOW = new Date("2026-07-22T12:00:00Z");
const PROVE_TIMEOUT = 180_000;

interface WireProof {
  readonly member: string;
  readonly proof: readonly number[];
  readonly publicInputs: readonly string[];
  readonly verifierTarget: string;
}

function toWireProof(proof: {
  readonly member: string;
  readonly proof: Uint8Array;
  readonly publicInputs: readonly string[];
  readonly verifierTarget: string;
}): WireProof {
  return {
    member: proof.member,
    proof: Array.from(proof.proof),
    publicInputs: [...proof.publicInputs],
    verifierTarget: proof.verifierTarget,
  };
}

interface DecisionBody {
  readonly status: "opened" | "declined";
  readonly reasons: readonly string[];
  readonly checks: {
    readonly orgIdentity: { readonly verified: boolean };
    readonly beneficialOwnership: { readonly verified: boolean };
    readonly officerAuthorization: { readonly verified: boolean };
    readonly disclosedThresholdOwnerCount: number | undefined;
    readonly tierA: Record<string, boolean>;
    readonly tierB: Record<string, boolean>;
  };
}

interface ChallengeBody {
  readonly tierA: { readonly sessionKey: string; readonly nonce: string };
  readonly tierB: { readonly sessionKey: string; readonly nonce: string };
}

async function backdateProfile(
  podBase: string,
  callerWebid: string,
  writerFetch: typeof fetch,
): Promise<void> {
  const profileResponse = await writerFetch(`${podBase}profile/card`, {
    body: `@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix pim: <http://www.w3.org/ns/pim/space#> .
<${callerWebid}> a foaf:Person ; foaf:name "Northwind Logistics LLC" ; pim:storage <${podBase}> .
`,
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    method: "PUT",
  });
  if (!profileResponse.ok)
    throw new Error(`could not seed profile card: ${profileResponse.status}`);
  const aclResponse = await writerFetch(`${podBase}profile/card.acl`, {
    body: `@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<#public> a acl:Authorization ; acl:accessTo <${podBase}profile/card> ; acl:agentClass foaf:Agent ; acl:mode acl:Read .
<#owner> a acl:Authorization ; acl:accessTo <${podBase}profile/card> ; acl:agent <${callerWebid}> ; acl:mode acl:Read, acl:Write, acl:Control .
`,
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    method: "PUT",
  });
  if (!aclResponse.ok) throw new Error(`could not lock profile card acl: ${aclResponse.status}`);
}

describe("the bank-onboarding rail", () => {
  let pods: SolidTestServer;
  let business1: SolidTestAccount;
  let business2: SolidTestAccount;
  let bank: SolidTestAccount;
  let caller1: TestCallerIssuer;
  let caller2: TestCallerIssuer;
  let podBase1: string;
  let podBase2: string;
  let service: OnboardingService;
  let route: FetchServer;
  let registrar1: { orgIdentity: string; beneficialOwnership: string };
  let registrar2: { orgIdentity: string; beneficialOwnership: string };

  const HIDDEN_TRUE_BPS = [4200, 2800, 2600, 1200] as const;

  beforeAll(async () => {
    [caller1, caller2] = await Promise.all([createTestCallerIssuer(), createTestCallerIssuer()]);

    pods = await startSolidServer({ oidc: true });
    business1 = pods.accounts[0] as SolidTestAccount;
    podBase1 = `${business1.baseUrl}/`;
    caller1.setStorage(podBase1);

    [business2, bank] = await Promise.all([pods.provisionAccount(), pods.provisionAccount()]);
    podBase2 = `${business2.baseUrl}/`;
    caller2.setStorage(podBase2);

    await Promise.all([
      backdateProfile(podBase1, caller1.webid, business1.authFetch),
      backdateProfile(podBase2, caller2.webid, business2.authFetch),
    ]);

    const [seed1, seed2] = await Promise.all([
      seedOnboardingPod({
        bankServiceWebId: bank.webid,
        fetchImpl: business1.authFetch,
        now: NOW,
        podBase: podBase1,
        webid: caller1.webid,
      }),
      seedOnboardingPod({
        bankServiceWebId: bank.webid,
        fetchImpl: business2.authFetch,
        now: NOW,
        podBase: podBase2,
        trueOwnerBps: HIDDEN_TRUE_BPS,
        webid: caller2.webid,
      }),
    ]);
    registrar1 = {
      beneficialOwnership: seed1.beneficialOwnershipRegistrar,
      orgIdentity: seed1.orgIdentityRegistrar,
    };
    registrar2 = {
      beneficialOwnership: seed2.beneficialOwnershipRegistrar,
      orgIdentity: seed2.orgIdentityRegistrar,
    };

    service = createOnboardingService({
      bank: {
        podServiceClientId: undefined,
        podServiceClientSecret: undefined,
        podServiceIssuer: undefined,
        serviceWebId: bank.webid,
        trustedCredentialIssuers: [
          registrar1.orgIdentity,
          registrar1.beneficialOwnership,
          registrar2.orgIdentity,
          registrar2.beneficialOwnership,
        ],
      },
      guardConfig: {
        allowInsecureLoopback: true,
        allowedPodOrigins: [pods.baseUrl, business2.baseUrl],
        trustedOidcIssuers: [caller1.origin, caller2.origin],
      },
      // Deliberately real wall-clock `now` (the default) — the seeded credentials' validity
      // window is wide (-60d/+305d around `NOW`, which itself sits close to real time), but
      // the ZK challenge-nonce store's consumer side always sweeps against REAL `Date.now()`
      // (`lib/server/zk-nonces.ts`, mirrored from `apps/vault`'s own nonce store); injecting a
      // fixed `now` here would desync the two clocks and expire every nonce before use.
      podFetch: bank.authFetch,
      publicRequestUrl: (request) => request.url,
    });

    route = await startFetchServer((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/api/kyb/challenge" && request.method === "POST") {
        return service.challenge(request);
      }
      if (url.pathname === "/api/kyb/decision" && request.method === "POST") {
        return service.decision(request);
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
  }, 120_000);

  afterAll(async () => {
    await route?.stop();
    await caller1?.close();
    await caller2?.close();
    await pods?.stop();
  });

  async function postJson(
    caller: TestCallerIssuer,
    path: string,
    body: unknown,
  ): Promise<Response> {
    return caller.fetch(`${route.origin}${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  }

  async function challenge(caller: TestCallerIssuer): Promise<ChallengeBody> {
    const response = await postJson(caller, "/api/kyb/challenge", {});
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as ChallengeBody;
  }

  async function honestTierAProof(nonce: string): Promise<TierAProof> {
    return proveOwnerThreshold({
      nonce,
      operandEnc: SAMPLE_OWNER_OPERAND_ENC,
      value: SAMPLE_OWNER_BPS,
    });
  }

  describe("boundary rejections", () => {
    test("anonymous POST /api/kyb/decision is 401 before any pod IO", async () => {
      const response = await fetch(`${route.origin}/api/kyb/decision`, {
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBeTruthy();
    });

    test("a caller-supplied webid override is rejected 400 before any pod IO", async () => {
      const response = await postJson(caller1, "/api/kyb/decision", {
        tierA: { nonce: "x", proof: {}, sessionKey: "x" },
        tierB: { nonce: "x", proof: {}, sessionKey: "x" },
        webid: "https://attacker.example/#me",
      });
      expect(response.status).toBe(400);
    });

    test("a malformed decision body is rejected 400 before any ZK verification", async () => {
      const response = await postJson(caller1, "/api/kyb/decision", { tierA: {}, tierB: {} });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("malformed_request");
    });
  });

  describe("the honest case", () => {
    test(
      "the honest Northwind case APPROVES with real credentials and real ZK proofs",
      async () => {
        const ch = await challenge(caller1);
        const northwindBps = NORTHWIND.owners.map((owner) => owner.ownershipPercentageBps);
        const arrayCommitment = await ownershipArrayCommitment(northwindBps);

        const tierAProof = await honestTierAProof(ch.tierA.nonce);
        const tierBProof = await proveCompleteness({
          arrayCommitment,
          bps: northwindBps,
          disclosedCount: 2,
          nonce: ch.tierB.nonce,
        });

        const response = await postJson(caller1, "/api/kyb/decision", {
          tierA: {
            nonce: ch.tierA.nonce,
            proof: toWireProof(tierAProof),
            sessionKey: ch.tierA.sessionKey,
          },
          tierB: {
            nonce: ch.tierB.nonce,
            proof: toWireProof(tierBProof),
            sessionKey: ch.tierB.sessionKey,
          },
        });
        expect(response.status, await response.clone().text()).toBe(200);
        const body = (await response.json()) as DecisionBody;
        expect(body.reasons).toEqual([]);
        expect(body.status).toBe("opened");
        expect(body.checks.orgIdentity.verified).toBe(true);
        expect(body.checks.beneficialOwnership.verified).toBe(true);
        expect(body.checks.officerAuthorization.verified).toBe(true);
        expect(body.checks.disclosedThresholdOwnerCount).toBe(2);
        expect(Object.values(body.checks.tierA).every(Boolean)).toBe(true);
        expect(Object.values(body.checks.tierB).every(Boolean)).toBe(true);
      },
      PROVE_TIMEOUT,
    );
  });

  describe("THE ZK-DECLINE PATH IS REAL (never asserted on a mock)", () => {
    test(
      "a byte-tampered Tier B proof DECLINES — real PROOF_INVALID from the real verifier",
      async () => {
        const ch = await challenge(caller1);
        const northwindBps = NORTHWIND.owners.map((owner) => owner.ownershipPercentageBps);
        const arrayCommitment = await ownershipArrayCommitment(northwindBps);

        const tierAProof = await honestTierAProof(ch.tierA.nonce);
        const tierBProof = await proveCompleteness({
          arrayCommitment,
          bps: northwindBps,
          disclosedCount: 2,
          nonce: ch.tierB.nonce,
        });
        const tamperedBytes = Uint8Array.from(tierBProof.proof);
        const flipIndex = Math.min(100, tamperedBytes.length - 1);
        tamperedBytes[flipIndex] = (tamperedBytes[flipIndex] ?? 0) ^ 0xff;
        const tamperedWire = { ...toWireProof(tierBProof), proof: Array.from(tamperedBytes) };

        const response = await postJson(caller1, "/api/kyb/decision", {
          tierA: {
            nonce: ch.tierA.nonce,
            proof: toWireProof(tierAProof),
            sessionKey: ch.tierA.sessionKey,
          },
          tierB: { nonce: ch.tierB.nonce, proof: tamperedWire, sessionKey: ch.tierB.sessionKey },
        });
        expect(response.status, await response.clone().text()).toBe(200);
        const body = (await response.json()) as DecisionBody;
        expect(body.status).toBe("declined");
        expect(body.checks.tierB.proof).toBe(false);
        expect(body.reasons.some((reason) => reason.includes("PROOF_INVALID"))).toBe(true);
      },
      PROVE_TIMEOUT,
    );

    test(
      "a REPLAYED proof DECLINES on the second submission — the nonce is burned on first use",
      async () => {
        const ch = await challenge(caller1);
        const northwindBps = NORTHWIND.owners.map((owner) => owner.ownershipPercentageBps);
        const arrayCommitment = await ownershipArrayCommitment(northwindBps);

        const tierAProof = await honestTierAProof(ch.tierA.nonce);
        const tierBProof = await proveCompleteness({
          arrayCommitment,
          bps: northwindBps,
          disclosedCount: 2,
          nonce: ch.tierB.nonce,
        });
        const requestBody = {
          tierA: {
            nonce: ch.tierA.nonce,
            proof: toWireProof(tierAProof),
            sessionKey: ch.tierA.sessionKey,
          },
          tierB: {
            nonce: ch.tierB.nonce,
            proof: toWireProof(tierBProof),
            sessionKey: ch.tierB.sessionKey,
          },
        };

        const first = await postJson(caller1, "/api/kyb/decision", requestBody);
        expect(first.status, await first.clone().text()).toBe(200);
        const firstBody = (await first.json()) as DecisionBody;
        expect(firstBody.status).toBe("opened");

        // The EXACT same challenge/proof, replayed byte-for-byte.
        const replay = await postJson(caller1, "/api/kyb/decision", requestBody);
        expect(replay.status, await replay.clone().text()).toBe(200);
        const replayBody = (await replay.json()) as DecisionBody;
        expect(replayBody.status).toBe("declined");
        expect(replayBody.checks.tierA.nonce).toBe(false);
        expect(replayBody.reasons.some((reason) => reason.includes("NONCE_INVALID"))).toBe(true);
      },
      PROVE_TIMEOUT,
    );

    test(
      "a hidden >=25% beneficial owner DECLINES: the honest completeness proof over the TRUE " +
        "array fails this bank's own disclosed-count cross-check",
      async () => {
        // business2's registrar genuinely anchored HIDDEN_TRUE_BPS (Marcus's true stake is
        // 2600 bps, >= the 2500-bps threshold) while the DISCLOSED BeneficialOwnershipCredential
        // still shows Marcus at 1800 bps (< threshold) — so this app's own
        // `disclosedThresholdOwnerCount` reads 2 from the disclosed credential, but an HONEST
        // completeness proof over the anchored TRUE array can only be produced for
        // disclosedCount=3 (the real count). Presenting that honest proof therefore fails this
        // app's STATEMENT_MISMATCH cross-check — a real rejection driven by real data.
        const ch = await challenge(caller2);
        const arrayCommitment = await ownershipArrayCommitment(HIDDEN_TRUE_BPS);

        const tierAProof = await honestTierAProof(ch.tierA.nonce);
        const tierBProof = await proveCompleteness({
          arrayCommitment,
          bps: HIDDEN_TRUE_BPS,
          disclosedCount: 3,
          nonce: ch.tierB.nonce,
        });

        const response = await postJson(caller2, "/api/kyb/decision", {
          tierA: {
            nonce: ch.tierA.nonce,
            proof: toWireProof(tierAProof),
            sessionKey: ch.tierA.sessionKey,
          },
          tierB: {
            nonce: ch.tierB.nonce,
            proof: toWireProof(tierBProof),
            sessionKey: ch.tierB.sessionKey,
          },
        });
        expect(response.status, await response.clone().text()).toBe(200);
        const body = (await response.json()) as DecisionBody;
        expect(body.status).toBe("declined");
        expect(body.checks.disclosedThresholdOwnerCount).toBe(2);
        expect(body.checks.tierB.statement).toBe(false);
        expect(body.reasons.some((reason) => reason.includes("STATEMENT_MISMATCH"))).toBe(true);
      },
      PROVE_TIMEOUT,
    );

    test(
      "separately: proveCompleteness itself REFUSES to produce a proof for an understated " +
        "disclosed count over a hidden-owner array (UNSATISFIABLE) — the ZK layer's own " +
        "forgery-proofing, exercised directly",
      async () => {
        const arrayCommitment = await ownershipArrayCommitment(HIDDEN_TRUE_BPS);
        await expect(
          proveCompleteness({
            arrayCommitment,
            bps: HIDDEN_TRUE_BPS,
            // Dishonestly claims only 2 threshold owners while the anchored TRUE array
            // truly has 3 (Jordan 4200, Priya 2800, Marcus 2600 all >= 2500 bps).
            disclosedCount: 2,
            nonce: "zk-test-nonce-hidden-owner-prove-refusal",
          }),
        ).rejects.toMatchObject({ code: "UNSATISFIABLE" });
      },
      PROVE_TIMEOUT,
    );
  });
});
