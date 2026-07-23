/**
 * Integration coverage of the real seeder against a REAL dev Solid server (`@kyb/test-kit`,
 * `@jeswr/solid-server` — never a mocked pod):
 *
 * - issue -> read back -> verify: every seeded credential and the Tier B ZK operand anchor
 *   are read back off the live pod and pass `verifyCredential`'s full fail-closed gate chain
 *   (structural, SHACL shape, validity window, Bitstring status, eddsa-rdfc-2022 proof)
 *   against the pod-served issuer documents and status lists.
 * - Tier B completeness: the seeded `kyb:beneficialOwnershipArrayCommitment` anchor supports
 *   a REAL `proveCompleteness`/`verifyCompleteness` round trip (genuine UltraHonk proving —
 *   this is the demo's headline completeness proof, design §4 row 2).
 * - Tier A honesty: in an environment with no local `jeswr/sparq` checkout (`SPARQ_CHECKOUT`),
 *   the seeder skips minting the per-owner threshold anchors rather than fabricating an
 *   operand encoding — asserted explicitly so a future regression (a fabricated encoding)
 *   would fail loudly.
 */
import { execFileSync } from "node:child_process";
import { validate } from "@kyb/data-model";
import { startSolidServer } from "@kyb/test-kit";
import {
  OWNERSHIP_THRESHOLD_BPS,
  ownershipArrayCommitment,
  proveCompleteness,
  proveOwnerThreshold,
  verifyCompleteness,
  type VerifyCompletenessOptions,
  verifyCredential,
  verifyOwnerThreshold,
  type VerifyOwnerThresholdOptions,
} from "@kyb/vc-kit";
import { afterEach, describe, expect, it } from "vitest";
import { CREDENTIAL_POD_PATHS, ISSUER_ROLES } from "../credentials.ts";
import { createKybIssuance } from "../issuance.ts";
import { seedKybPod } from "../kyb-pod.ts";

const NOW = new Date("2026-07-22T12:00:00.000Z");
const PROVE_TIMEOUT = 180_000;

function cargoAvailable(): boolean {
  try {
    execFileSync("cargo", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Mirrors `../issuance.ts`'s own `tierANativeBridgeAvailable` gate exactly (and
 * `@kyb/vc-kit`'s own `seed-tooling-native.test.ts`) — this suite only proves the REAL Tier
 * A round trip when the seeder itself could genuinely mint. */
const TIER_A_NATIVE_AVAILABLE =
  process.env.SPARQ_CHECKOUT !== undefined &&
  process.env.SPARQ_CHECKOUT.length > 0 &&
  cargoAvailable();

/** One-shot nonce consumer accepting exactly (sessionKey, nonce) — then burned. Ported from
 * `@kyb/vc-kit`'s own test rig (`test/zk-support.ts`, a test fixture, not a package export). */
function oneShotNonce(sessionKey: string, nonce: string) {
  let live = true;
  return {
    consume(gotSession: string, gotNonce: string): boolean {
      if (!live || gotSession !== sessionKey || gotNonce !== nonce) return false;
      live = false;
      return true;
    },
  };
}

describe("seedKybPod — issue, read back, verify (real pod, real vc-kit)", () => {
  let stop: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await stop?.();
    stop = undefined;
  });

  it("every signed credential + the Tier B anchor verify against the live pod", async () => {
    const server = await startSolidServer({});
    stop = server.stop;
    const account = server.accounts[0];
    if (account === undefined) throw new Error("harness booted with no primary account");

    const issuance = createKybIssuance({ podOrigin: account.baseUrl, now: NOW });
    const seeded = await seedKybPod({
      target: { webid: account.webid, baseUrl: account.baseUrl, authFetch: account.authFetch },
      issuance,
      now: NOW,
      mode: "create",
    });

    expect(seeded.persona.businessName).toBe("Northwind Logistics LLC");
    expect(seeded.credentials).toHaveLength(3);
    const podRoot = new URL(account.baseUrl).origin;

    for (const spec of seeded.credentials) {
      const resourceUrl = `${podRoot}${spec.path}`;
      const response = await account.authFetch(resourceUrl);
      expect(response.status, `GET ${resourceUrl}`).toBe(200);
      const body = await response.text();

      const outcome = await verifyCredential(body, {
        expectShape: spec.kind,
        now: NOW,
        webIdFetch: account.authFetch,
        statusFetch: account.authFetch,
      });
      expect(outcome.errors, `${spec.id} verification errors`).toEqual([]);
      expect(outcome.verified, `${spec.id} verified`).toBe(true);
      expect(outcome.credential?.subject).toBe(account.webid);
    }

    // The brief's explicit SHACL call: the beneficial-ownership credential re-validated
    // directly against the bundled KYB shapes (independent of verifyCredential's own gate).
    const boResponse = await account.authFetch(
      `${podRoot}${CREDENTIAL_POD_PATHS.beneficialOwnership}`,
    );
    const boTurtle = await boResponse.text();
    const report = await validate(boTurtle, {
      baseIRI: `${podRoot}${CREDENTIAL_POD_PATHS.beneficialOwnership}`,
      expect: "beneficial-ownership-credential",
      focusNode: `${podRoot}${CREDENTIAL_POD_PATHS.beneficialOwnership}`,
    });
    expect(report.violations).toEqual([]);
    expect(report.conforms).toBe(true);

    // Tier B (design §4 row 2, always real): the array-commitment anchor.
    const tierBResponse = await account.authFetch(`${podRoot}${seeded.tierB.path}`);
    expect(tierBResponse.status).toBe(200);
    const tierBBody = await tierBResponse.text();
    const tierBOutcome = await verifyCredential(tierBBody, {
      expectShape: "zk-operand-anchor",
      now: NOW,
      webIdFetch: account.authFetch,
      statusFetch: account.authFetch,
    });
    expect(tierBOutcome.errors).toEqual([]);
    expect(tierBOutcome.verified).toBe(true);
    // The anchored commitment matches an independent recomputation over the SAME owner
    // array in the SAME order the seeder minted it with — no drift between the two.
    const recomputed = await ownershipArrayCommitment(
      seeded.persona.owners.map((owner) => owner.ownershipPercentageBps),
    );
    expect(seeded.tierB.arrayCommitment).toBe(recomputed);

    // Tier A honesty gate (design §4 row 1): this build environment has no local
    // jeswr/sparq checkout, so the seeder must SKIP minting per-owner threshold anchors
    // rather than fabricate an operand encoding — asserted explicitly, and mirrored against
    // whichever branch the CURRENT environment actually supports (some future CI runner may
    // carry SPARQ_CHECKOUT, in which case the anchors must be genuinely minted and verify).
    if (process.env.SPARQ_CHECKOUT === undefined || process.env.SPARQ_CHECKOUT.length === 0) {
      expect(seeded.tierA.status).toBe("skipped-no-sparq-checkout");
      if (seeded.tierA.status === "skipped-no-sparq-checkout") {
        expect(seeded.tierA.reason).toContain("SPARQ_CHECKOUT");
      }
      // No per-owner anchor path was written to the pod — nothing to verify, nothing faked.
      for (const owner of seeded.persona.owners) {
        const anchorUrl = `${podRoot}/kyb/zk/anchor-bps-${owner.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-+|-+$)/g, "")}`;
        const anchorResponse = await account.authFetch(anchorUrl);
        expect(anchorResponse.status, `GET ${anchorUrl}`).toBe(404);
      }
    } else {
      expect(seeded.tierA.status).toBe("minted");
      if (seeded.tierA.status === "minted") {
        expect(seeded.tierA.anchors).toHaveLength(seeded.persona.owners.length);
        for (const anchor of seeded.tierA.anchors) {
          const anchorResponse = await account.authFetch(`${podRoot}${anchor.path}`);
          expect(anchorResponse.status).toBe(200);
          const anchorOutcome = await verifyCredential(await anchorResponse.text(), {
            expectShape: "zk-operand-anchor",
            now: NOW,
            webIdFetch: account.authFetch,
            statusFetch: account.authFetch,
          });
          expect(anchorOutcome.errors).toEqual([]);
          expect(anchorOutcome.verified).toBe(true);
        }
      }
    }
  });

  it(
    "the seeded Tier B anchor supports a REAL proveCompleteness / verifyCompleteness round trip",
    async () => {
      const server = await startSolidServer({});
      stop = server.stop;
      const account = server.accounts[0];
      if (account === undefined) throw new Error("harness booted with no primary account");

      const issuance = createKybIssuance({ podOrigin: account.baseUrl, now: NOW });
      const seeded = await seedKybPod({
        target: { webid: account.webid, baseUrl: account.baseUrl, authFetch: account.authFetch },
        issuance,
        now: NOW,
        mode: "create",
      });
      const podRoot = new URL(account.baseUrl).origin;
      const tierBResponse = await account.authFetch(`${podRoot}${seeded.tierB.path}`);
      const anchorBody = await tierBResponse.text();

      // Jordan Blake (4200 bps) and Priya Nandakumar (2800 bps) are the two disclosed
      // >= 25% owners (design §7) — the honest disclosedCount for this proof.
      const bps = seeded.persona.owners.map((owner) => owner.ownershipPercentageBps);
      const disclosedCount = seeded.persona.owners.filter(
        (owner) => owner.ownershipPercentageBps >= OWNERSHIP_THRESHOLD_BPS,
      ).length;
      expect(disclosedCount).toBe(2);

      const nonce = "seeder-integration-completeness-nonce";
      const proof = await proveCompleteness({
        bps,
        arrayCommitment: seeded.tierB.arrayCommitment,
        disclosedCount,
        nonce,
      });

      const session = "seeder-integration-session";
      const options: VerifyCompletenessOptions = {
        anchorVc: anchorBody,
        webid: account.webid,
        nonce,
        nonces: oneShotNonce(session, nonce),
        sessionKey: session,
        now: NOW,
        trustedIssuers: [`${podRoot}${ISSUER_ROLES.beneficialOwnershipRegistrar.docPath}`],
        webIdFetch: account.authFetch,
        statusFetch: account.authFetch,
        disclosedCount,
      };
      const result = await verifyCompleteness(proof, options);
      expect(result.errors).toEqual([]);
      expect(result.verified).toBe(true);
    },
    PROVE_TIMEOUT,
  );

  it.skipIf(!TIER_A_NATIVE_AVAILABLE)(
    "the seeded Tier A anchors support a REAL proveOwnerThreshold / verifyOwnerThreshold " +
      "round trip, minted from the GENUINE native sparq bridge (gated on SPARQ_CHECKOUT)",
    async () => {
      const server = await startSolidServer({});
      stop = server.stop;
      const account = server.accounts[0];
      if (account === undefined) throw new Error("harness booted with no primary account");

      const issuance = createKybIssuance({ podOrigin: account.baseUrl, now: NOW });
      const seeded = await seedKybPod({
        target: { webid: account.webid, baseUrl: account.baseUrl, authFetch: account.authFetch },
        issuance,
        now: NOW,
        mode: "create",
      });
      expect(seeded.tierA.status).toBe("minted");
      if (seeded.tierA.status !== "minted") return;

      const podRoot = new URL(account.baseUrl).origin;
      const trustedIssuer = `${podRoot}${ISSUER_ROLES.beneficialOwnershipRegistrar.docPath}`;

      // Jordan Blake — 4200 bps (42%), the persona's managing officer and first ABOVE-
      // threshold (>= 2500 bps) owner (design §7). The anchor's operandEnc is the GENUINE
      // sparq encode_int_literal(4200) output the native bridge minted moments ago — never
      // a fixture value borrowed from a different persona's bps.
      const jordan = seeded.persona.owners[0];
      if (jordan === undefined) throw new Error("persona has no first owner");
      expect(jordan.name).toBe("Jordan Blake");
      expect(jordan.ownershipPercentageBps).toBe(4200);
      expect(jordan.ownershipPercentageBps).toBeGreaterThanOrEqual(OWNERSHIP_THRESHOLD_BPS);

      const jordanAnchor = seeded.tierA.anchors.find((anchor) =>
        anchor.path.endsWith("anchor-bps-jordan-blake"),
      );
      if (jordanAnchor === undefined)
        throw new Error("Jordan Blake's Tier A anchor was not minted");

      const anchorResponse = await account.authFetch(`${podRoot}${jordanAnchor.path}`);
      expect(anchorResponse.status).toBe(200);
      const anchorBody = await anchorResponse.text();

      const nonce = "seeder-integration-tier-a-nonce";
      const proof = await proveOwnerThreshold({
        value: jordan.ownershipPercentageBps,
        operandEnc: jordanAnchor.operandEnc,
        nonce,
      });

      const session = "seeder-integration-tier-a-session";
      const options: VerifyOwnerThresholdOptions = {
        anchorVc: anchorBody,
        webid: account.webid,
        nonce,
        nonces: oneShotNonce(session, nonce),
        sessionKey: session,
        now: NOW,
        trustedIssuers: [trustedIssuer],
        webIdFetch: account.authFetch,
        statusFetch: account.authFetch,
      };
      const result = await verifyOwnerThreshold(proof, options);
      expect(result.errors).toEqual([]);
      expect(result.verified).toBe(true);
    },
    PROVE_TIMEOUT,
  );
});

describe("seedKybPod — OIDC mode: owner-only ACL denies a second identity", () => {
  let stop: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await stop?.();
    stop = undefined;
  });

  it("a second identity is denied the private credentials; the issuer doc + status list stay public", async () => {
    const server = await startSolidServer({ oidc: true });
    stop = server.stop;
    const business = server.accounts[0];
    if (business === undefined) throw new Error("harness booted with no primary account");

    const issuance = createKybIssuance({ podOrigin: business.baseUrl, now: NOW });
    await seedKybPod({
      target: { webid: business.webid, baseUrl: business.baseUrl, authFetch: business.authFetch },
      issuance,
      now: NOW,
      mode: "create",
    });

    const podRoot = new URL(business.baseUrl).origin;
    const privateUrl = `${podRoot}${CREDENTIAL_POD_PATHS.beneficialOwnership}`;
    const issuerDocUrl = `${podRoot}${ISSUER_ROLES.beneficialOwnershipRegistrar.docPath}`;
    const statusListUrl = `${podRoot}${ISSUER_ROLES.beneficialOwnershipRegistrar.statusPath}`;

    // Sanity: the owner CAN read its own private resource.
    const ownerRead = await business.authFetch(privateUrl);
    expect(ownerRead.status).toBe(200);

    // A second, independently-provisioned identity (its own dev-OIDC-issued token) is
    // denied — owner-only WAC, exercised through the real DPoP-bound auth path.
    const attacker = await server.provisionAccount();
    expect(attacker.webid).not.toBe(business.webid);
    const attackerRead = await attacker.authFetch(privateUrl);
    expect([401, 403]).toContain(attackerRead.status);

    // Anonymous (no credentials at all) is denied too.
    const anonymousRead = await fetch(privateUrl);
    expect([401, 403]).toContain(anonymousRead.status);

    // The issuer identity document and its status list are world-readable — anonymous
    // fetch, no credentials attached.
    const issuerDocRead = await fetch(issuerDocUrl);
    expect(issuerDocRead.status).toBe(200);
    const statusListRead = await fetch(statusListUrl);
    expect(statusListRead.status).toBe(200);

    await attacker.stop();
  });
});
