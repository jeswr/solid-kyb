/**
 * Scene 3's prove-in-browser rail (`../lib/server/zk-service.ts`), exercised end-to-end
 * against a REAL seeded pod: genuine UltraHonk Tier A (per-owner threshold) and Tier B
 * (completeness) proofs, checked by the real fail-closed verifiers. Nothing here is mocked
 * — see `../lib/server/kyb-issuance.ts`'s header for the Tier A captured-encoding honesty
 * note.
 */
import { startSolidServer, type SolidTestServer } from "@kyb/test-kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedNorthwindPod } from "../lib/server/kyb-issuance";
import { issueChallenge, proveAndVerify } from "../lib/server/zk-service";

const NOW = new Date("2026-07-22T12:00:00Z");
const PROVE_TIMEOUT = 180_000;

let pods: SolidTestServer;
let podBase: string;
let webid: string;

beforeAll(async () => {
  pods = await startSolidServer({});
  const primary = pods.accounts[0];
  if (primary === undefined) throw new Error("harness did not provision an owner");
  podBase = `${primary.baseUrl}/`;
  webid = primary.webid;
  await seedNorthwindPod({ podBase, webid, now: NOW });
}, 60_000);

afterAll(async () => {
  await pods?.stop();
});

describe("proveAndVerify", () => {
  it(
    "produces and verifies genuine Tier A + Tier B proofs over the seeded pod",
    async () => {
      // The nonce store's TTL sweep always reads the REAL wall clock (see
      // `../lib/server/zk-nonces.ts`), independent of the fictional credential-validity
      // `now` below — mint the challenge against real time so it is not evicted as
      // "expired" before `proveAndVerify` consumes it.
      const challenge = issueChallenge();
      const result = await proveAndVerify({ podBase, webid, challenge, now: NOW });

      expect(result.tierA.verification.errors).toEqual([]);
      expect(result.tierA.verification.verified).toBe(true);
      expect(result.tierA.proof.verifierTarget).toBe("evm");

      expect(result.tierB.verification.errors).toEqual([]);
      expect(result.tierB.verification.verified).toBe(true);
      expect(result.tierB.proof.member).toBe("kyb_completeness_scan_n8");
    },
    PROVE_TIMEOUT,
  );

  it(
    "a replayed challenge fails closed (single-use nonce; verify never re-passes)",
    async () => {
      // The nonce store's TTL sweep always reads the REAL wall clock (see
      // `../lib/server/zk-nonces.ts`), independent of the fictional credential-validity
      // `now` below — mint the challenge against real time so it is not evicted as
      // "expired" before `proveAndVerify` consumes it.
      const challenge = issueChallenge();
      const first = await proveAndVerify({ podBase, webid, challenge, now: NOW });
      expect(first.tierA.verification.verified).toBe(true);
      expect(first.tierB.verification.verified).toBe(true);

      // Same challenge presented again: the nonce store already burned both tiers'
      // nonces, so re-verification must fail closed rather than silently re-passing.
      const replay = await proveAndVerify({ podBase, webid, challenge, now: NOW });
      expect(replay.tierA.verification.verified).toBe(false);
      expect(replay.tierA.verification.errors[0]?.code).toBe("NONCE_INVALID");
      expect(replay.tierB.verification.verified).toBe(false);
      expect(replay.tierB.verification.errors[0]?.code).toBe("NONCE_INVALID");
    },
    PROVE_TIMEOUT,
  );
});
