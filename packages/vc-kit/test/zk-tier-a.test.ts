/**
 * Tier A verification - the MANDATORY operand-anchor binding (design §4),
 * exercised end-to-end with GENUINE UltraHonk proofs (proved live in this
 * suite; see zk-support.ts) and a full negative matrix. SECURITY-CRITICAL:
 * every negative test asserts rejection of a scenario in which all OTHER
 * gates pass - no test is vacuous.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { KYB } from "@kyb/data-model";
import type { IssuedCredential, TierAProof, VerifyOwnerThresholdOptions } from "../src/index.ts";
import { proveOwnerThreshold, verifyOwnerThreshold } from "../src/index.ts";
import { ISSUER, NOW, resolveIssuerKey, SUBJECT } from "./support.ts";
import {
  ABOVE_THRESHOLD_BPS,
  aboveThresholdProof,
  type AnchorRig,
  anchorRig,
  encOf,
  forgedProof,
  NONCE_ABOVE,
  NONCE_FORGED,
  oneShotNonce,
} from "./zk-support.ts";

const PROVE_TIMEOUT = 180_000;
const SESSION = "session-1";

let rig: AnchorRig;
let anchorOwnership: IssuedCredential;
let proofOwnership: TierAProof;

/** Baseline options: every gate passes unless a test overrides one input. */
function baseOptions(
  overrides: Partial<VerifyOwnerThresholdOptions> = {},
): VerifyOwnerThresholdOptions {
  return {
    anchorVc: anchorOwnership.body,
    webid: SUBJECT,
    nonce: NONCE_ABOVE,
    nonces: oneShotNonce(SESSION, NONCE_ABOVE),
    sessionKey: SESSION,
    now: NOW,
    trustedIssuers: [ISSUER],
    resolveKey: resolveIssuerKey,
    statusFetch: rig.host.fetch,
    ...overrides,
  };
}

beforeAll(async () => {
  rig = await anchorRig(); // genuine anchor: ownershipPercentageBps, enc(2860), SUBJECT
  anchorOwnership = await rig.issue();
  proofOwnership = await aboveThresholdProof();
}, PROVE_TIMEOUT);

describe("verifyOwnerThreshold - acceptance", () => {
  it("accepts a live proof bound to its issuer-signed operand anchor", async () => {
    const result = await verifyOwnerThreshold(proofOwnership, baseOptions());
    expect(result.errors).toEqual([]);
    expect(result.verified).toBe(true);
    expect(result.checks).toEqual({
      structural: true,
      nonce: true,
      challenge: true,
      statement: true,
      anchor: true,
      subject: true,
      field: true,
      operandBinding: true,
      proof: true,
    });
    expect(result.anchor?.verified).toBe(true);
    expect(result.anchor?.credential?.issuer).toBe(ISSUER);
  });

  it("works against a fresh single-use nonce store, and rejects an identical replay", async () => {
    const nonce = "zk-test-nonce-fresh-mint";
    const store = oneShotNonce(SESSION, nonce);
    const proof = await proveOwnerThreshold({
      value: ABOVE_THRESHOLD_BPS,
      operandEnc: encOf(ABOVE_THRESHOLD_BPS),
      nonce,
    });
    const first = await verifyOwnerThreshold(proof, baseOptions({ nonce, nonces: store }));
    expect(first.verified).toBe(true);
    const replay = await verifyOwnerThreshold(proof, baseOptions({ nonce, nonces: store }));
    expect(replay.verified).toBe(false);
    expect(replay.errors[0]?.code).toBe("NONCE_INVALID");
  });
});

describe("verifyOwnerThreshold - the negative matrix (every scenario must REJECT)", () => {
  it(
    "FORGEABILITY REGRESSION: a valid proof over a self-minted encoding with a genuine anchor for the real value",
    async () => {
      // The adversary's true stake is 500 bps (5%, < 25%). Their issuer
      // honestly anchored enc(500). Because operand_enc is deterministic and
      // salt-free, the adversary computes enc(9999) themselves and honestly
      // proves 9999 >= 2500 - a VALID UltraHonk proof, fresh nonce, genuine
      // anchor VC, correct subject, correct field. ONLY the anchor-equality
      // gate stands between this and a false "owner >= 25%" claim.
      const forged = await forgedProof();
      const genuineAnchorForRealStake = await rig.issue({ operandEnc: encOf(500), index: 11 });
      const result = await verifyOwnerThreshold(forged, {
        ...baseOptions({
          anchorVc: genuineAnchorForRealStake.body,
          nonce: NONCE_FORGED,
          nonces: oneShotNonce(SESSION, NONCE_FORGED),
        }),
      });
      expect(result.verified).toBe(false);
      expect(result.errors[0]?.code).toBe("ANCHOR_OPERAND_MISMATCH");
    },
    PROVE_TIMEOUT,
  );

  it("wrong nonce: the presented nonce is not the session's live challenge", async () => {
    const result = await verifyOwnerThreshold(proofOwnership, {
      ...baseOptions({ nonces: oneShotNonce(SESSION, "a-different-nonce") }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("NONCE_INVALID");
  });

  it("stolen-challenge: a proof produced for ANOTHER nonce, presented with the live one", async () => {
    const live = "freshly-minted-other-nonce";
    const result = await verifyOwnerThreshold(proofOwnership, {
      ...baseOptions({ nonce: live, nonces: oneShotNonce(SESSION, live) }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("CHALLENGE_MISMATCH");
  });

  it("revoked anchor: the issuer set the anchor's status bit", async () => {
    const revokedAnchor = await rig.issue({ index: 13 });
    await rig.revoke(13);
    const result = await verifyOwnerThreshold(proofOwnership, {
      ...baseOptions({ anchorVc: revokedAnchor.body }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("ANCHOR_INVALID");
    expect(result.errors[0]?.message).toContain("STATUS_REVOKED");
  });

  it("unreachable status list fails closed", async () => {
    const result = await verifyOwnerThreshold(proofOwnership, {
      ...baseOptions({ statusFetch: async () => new Response("boom", { status: 500 }) }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("ANCHOR_INVALID");
  });

  it("wrong-subject anchor: anchored to a different WebID than the presenter", async () => {
    const foreignAnchor = await rig.issue({
      subject: "https://mallory.example/profile/card#me",
      index: 15,
    });
    const result = await verifyOwnerThreshold(proofOwnership, {
      ...baseOptions({ anchorVc: foreignAnchor.body }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("ANCHOR_SUBJECT_MISMATCH");
  });

  it("presenter WebID does not match the anchor subject", async () => {
    const result = await verifyOwnerThreshold(proofOwnership, {
      ...baseOptions({ webid: "https://mallory.example/profile/card#me" }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("ANCHOR_SUBJECT_MISMATCH");
  });

  it("wrong-field anchor: anchors the array-commitment field, not the per-owner one", async () => {
    const wrongFieldAnchor = await rig.issue({
      field: KYB.beneficialOwnershipArrayCommitment,
      operandEnc: encOf(ABOVE_THRESHOLD_BPS),
      index: 17,
    });
    const result = await verifyOwnerThreshold(proofOwnership, {
      ...baseOptions({ anchorVc: wrongFieldAnchor.body }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("ANCHOR_FIELD_MISMATCH");
  });

  it("expired anchor rejects", async () => {
    const expiredAnchor = await rig.issue({
      index: 19,
      validity: {
        validFrom: new Date(NOW.getTime() - 60 * 24 * 3600 * 1000),
        validUntil: new Date(NOW.getTime() - 30 * 24 * 3600 * 1000),
      },
    });
    const result = await verifyOwnerThreshold(proofOwnership, {
      ...baseOptions({ anchorVc: expiredAnchor.body }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("ANCHOR_INVALID");
    expect(result.errors[0]?.message).toContain("EXPIRED");
  });

  it("untrusted anchor issuer rejects", async () => {
    const result = await verifyOwnerThreshold(proofOwnership, {
      ...baseOptions({ trustedIssuers: ["https://someone-else.example/org"] }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("ANCHOR_INVALID");
    expect(result.errors[0]?.message).toContain("UNTRUSTED_ISSUER");
  });

  it(
    "tampered anchor document: signature must not survive an operandEnc edit",
    async () => {
      const tamperedBody = anchorOwnership.body.replace(encOf(ABOVE_THRESHOLD_BPS), encOf(9999));
      expect(tamperedBody).not.toBe(anchorOwnership.body);
      const forged = await forgedProof();
      const result = await verifyOwnerThreshold(forged, {
        ...baseOptions({
          anchorVc: tamperedBody,
          nonce: NONCE_FORGED,
          nonces: oneShotNonce(SESSION, NONCE_FORGED),
        }),
      });
      expect(result.verified).toBe(false);
      expect(result.errors[0]?.code).toBe("ANCHOR_INVALID");
      expect(result.errors[0]?.message).toContain("INVALID_SIGNATURE");
    },
    PROVE_TIMEOUT,
  );

  it("tampered proof bytes reject", async () => {
    const tampered = Uint8Array.from(proofOwnership.proof);
    tampered[100] = (tampered[100] ?? 0) ^ 0xff;
    const result = await verifyOwnerThreshold(
      { ...proofOwnership, proof: tampered },
      baseOptions(),
    );
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("PROOF_INVALID");
  });

  it("tampered public inputs reject (operand swap breaks the transcript)", async () => {
    const swappedAnchor = await rig.issue({ operandEnc: encOf(9999), index: 21 });
    const inputs = [...proofOwnership.publicInputs];
    inputs[1] = encOf(9999);
    const result = await verifyOwnerThreshold(
      { ...proofOwnership, publicInputs: inputs },
      baseOptions({ anchorVc: swappedAnchor.body }),
    );
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("PROOF_INVALID");
  });

  it("*-no-zk flavours are rejected before any cryptography runs", async () => {
    for (const flavour of ["evm-no-zk", "noir-recursive-no-zk", "starknet-no-zk", "poseidon2"]) {
      const result = await verifyOwnerThreshold(
        { ...proofOwnership, verifierTarget: flavour },
        baseOptions(),
      );
      expect(result.verified).toBe(false);
      expect(result.errors[0]?.code).toBe("FORBIDDEN_FLAVOUR");
    }
  });

  it("unknown circuit members are rejected", async () => {
    const result = await verifyOwnerThreshold(
      { ...proofOwnership, member: "filter_int_d9" },
      baseOptions(),
    );
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("UNKNOWN_MEMBER");
  });

  it("the Tier B member is rejected by the Tier A verifier", async () => {
    const result = await verifyOwnerThreshold(
      { ...proofOwnership, member: "kyb_completeness_scan_n8" },
      baseOptions(),
    );
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("UNKNOWN_MEMBER");
  });

  it("wrong public-input count is rejected", async () => {
    const result = await verifyOwnerThreshold(
      { ...proofOwnership, publicInputs: proofOwnership.publicInputs.slice(0, 4) },
      baseOptions(),
    );
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("MALFORMED_PROOF");
  });

  it("a bound different from the advertised statement is rejected", async () => {
    const result = await verifyOwnerThreshold(proofOwnership, {
      ...baseOptions({ statement: { field: KYB.ownershipPercentageBps, bound: 3000 } }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("STATEMENT_MISMATCH");
  });

  it("an unknown statement field is rejected", async () => {
    const result = await verifyOwnerThreshold(proofOwnership, {
      ...baseOptions({ statement: { field: "https://example.org/not-a-zk-field", bound: 2500 } }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("UNKNOWN_FIELD");
  });

  it("an omitted/empty issuer allowlist fails closed (never accepts any issuer)", async () => {
    for (const bad of [
      [] as string[],
      undefined as unknown as string[],
      "https://issuer.example/org" as unknown as string[],
    ]) {
      const result = await verifyOwnerThreshold(proofOwnership, {
        ...baseOptions({ trustedIssuers: bad }),
      });
      expect(result.verified).toBe(false);
      expect(result.errors[0]?.code).toBe("ANCHOR_INVALID");
      expect(result.errors[0]?.message).toContain("allowlist");
      expect(result.checks.structural).toBe(false);
    }
  });

  it("an invalid `now` fails closed (a NaN instant must not bypass the window)", async () => {
    const result = await verifyOwnerThreshold(proofOwnership, {
      ...baseOptions({ now: new Date("not-a-date") }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("ANCHOR_INVALID");
    expect(result.errors[0]?.message).toContain("valid Date");
  });

  it("an oversized proof payload is rejected before verification", async () => {
    const result = await verifyOwnerThreshold(
      { ...proofOwnership, proof: new Uint8Array(131_073) },
      baseOptions(),
    );
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("MALFORMED_PROOF");
  });

  it("a malformed presentation never burns the nonce (gates 0-1 precede gate 2)", async () => {
    const nonces = oneShotNonce(SESSION, NONCE_ABOVE);
    const malformed = await verifyOwnerThreshold(
      { ...proofOwnership, proof: new Uint8Array(131_073) },
      baseOptions({ nonces }),
    );
    expect(malformed.verified).toBe(false);
    expect(malformed.errors[0]?.code).toBe("MALFORMED_PROOF");
    const retry = await verifyOwnerThreshold(proofOwnership, baseOptions({ nonces }));
    expect(retry.verified).toBe(true);
  });

  it("a failed attempt (past gate 1) burns the challenge: no second try on the same nonce", async () => {
    const nonces = oneShotNonce(SESSION, NONCE_ABOVE);
    const foreignAnchor = await rig.issue({
      subject: "https://mallory.example/profile/card#me",
      index: 23,
    });
    const attempt = await verifyOwnerThreshold(proofOwnership, {
      ...baseOptions({ nonces, anchorVc: foreignAnchor.body }),
    });
    expect(attempt.verified).toBe(false);
    const retry = await verifyOwnerThreshold(proofOwnership, { ...baseOptions({ nonces }) });
    expect(retry.verified).toBe(false);
    expect(retry.errors[0]?.code).toBe("NONCE_INVALID");
  });
});
