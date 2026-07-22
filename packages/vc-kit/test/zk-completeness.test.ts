/**
 * Tier B verification - THIS PACKAGE'S OWN bespoke completeness-scan circuit
 * (design §4 row 2: "no undisclosed beneficial owner holds >= 25%"),
 * exercised end-to-end with GENUINE UltraHonk proofs (proved live in this
 * suite - see kyb_completeness_scan_n8's PROVENANCE header for why this
 * circuit is live-provable, unlike the mortgage/lending showcases' Tier B).
 *
 * THE PREDICATE, exactly: over the FULL hidden owner array (Northwind's four
 * owners: Jordan 4200, Priya 2800, Marcus 1800, Dana 1200 bps), the business
 * discloses that EXACTLY `disclosedCount` owners are >= the 2500-bps (25%)
 * threshold (Jordan and Priya - 2 owners). The completeness circuit proves
 * this count is exactly right: an UNDISCLOSED >= 25% owner (i.e. a THIRD
 * owner secretly also >= 2500 bps that the business did not disclose) would
 * make the REAL count 3, not 2 - UNSATISFIABLE against disclosedCount=2. This
 * is deliberately NOT "every owner is < 25%" (Marcus 18% and Dana 12% ARE
 * disclosed as owners too, just not as >= 25% owners) - the predicate is
 * purely about the 25% THRESHOLD boundary, matching the design's "no
 * undisclosed beneficial owner >= 25%" wording precisely.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { KYB } from "@kyb/data-model";
import type { CompletenessProof, IssuedCredential } from "../src/index.ts";
import {
  OWNERSHIP_THRESHOLD_BPS,
  ownershipArrayCommitment,
  proveCompleteness,
  verifyCompleteness,
  type VerifyCompletenessOptions,
  ZkError,
} from "../src/index.ts";
import {
  BACKDATED_VALIDITY,
  hostedStatusList,
  ISSUER,
  issuerKey,
  NOW,
  resolveIssuerKey,
  stubHost,
  SUBJECT,
} from "./support.ts";
import { issueCredential } from "../src/index.ts";
import { oneShotNonce } from "./zk-support.ts";

const PROVE_TIMEOUT = 180_000;
const SESSION = "session-completeness-1";

/** Northwind Logistics LLC's full owner array (design §7), padded to 8 by the tooling. */
const NORTHWIND_OWNERS = [4200, 2800, 1800, 1200] as const;
/** Jordan (4200) and Priya (2800) are the disclosed >= 25% owners. */
const NORTHWIND_DISCLOSED_COUNT = 2;

async function mintArrayAnchor(
  host: ReturnType<typeof stubHost>,
  bps: readonly number[],
  index: number,
): Promise<{ readonly anchor: IssuedCredential; readonly arrayCommitment: string }> {
  const list = await hostedStatusList(host);
  const arrayCommitment = await ownershipArrayCommitment(bps);
  const anchor = await issueCredential({
    kind: "zk-operand-anchor",
    credentialId: `https://northwind.pod.example/kyb/credentials/anchors/array-${index}`,
    issuer: ISSUER,
    subject: SUBJECT,
    claims: {
      kind: "zk-operand-anchor",
      field: KYB.beneficialOwnershipArrayCommitment,
      operandEnc: arrayCommitment,
    },
    validity: BACKDATED_VALIDITY,
    status: list.entry(index),
    key: await issuerKey(),
  });
  return { anchor, arrayCommitment };
}

describe("proveCompleteness / verifyCompleteness - the honest case", () => {
  let host: ReturnType<typeof stubHost>;
  let anchor: IssuedCredential;
  let arrayCommitment: string;
  let proof: CompletenessProof;

  beforeAll(async () => {
    host = stubHost();
    ({ anchor, arrayCommitment } = await mintArrayAnchor(host, NORTHWIND_OWNERS, 1));
    proof = await proveCompleteness({
      bps: NORTHWIND_OWNERS,
      arrayCommitment,
      disclosedCount: NORTHWIND_DISCLOSED_COUNT,
      nonce: "zk-test-nonce-completeness-honest",
    });
  }, PROVE_TIMEOUT);

  it("produces a genuine UltraHonk proof (evm flavour, real transcript)", () => {
    expect(proof.member).toBe("kyb_completeness_scan_n8");
    expect(proof.verifierTarget).toBe("evm");
    expect(proof.proof.length).toBeGreaterThan(0);
    expect(proof.publicInputs).toHaveLength(5);
  });

  it("verifies against the mandatory operand anchor", async () => {
    const nonce = "zk-test-nonce-completeness-honest";
    const options: VerifyCompletenessOptions = {
      anchorVc: anchor.body,
      webid: SUBJECT,
      nonce,
      nonces: oneShotNonce(SESSION, nonce),
      sessionKey: SESSION,
      now: NOW,
      trustedIssuers: [ISSUER],
      resolveKey: resolveIssuerKey,
      statusFetch: host.fetch,
      disclosedCount: NORTHWIND_DISCLOSED_COUNT,
    };
    const result = await verifyCompleteness(proof, options);
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
  });
});

describe("proveCompleteness - fail-closed pre-flight gates", () => {
  it("refuses to prove over an array that does not match the anchored commitment", async () => {
    const wrongCommitment = await ownershipArrayCommitment([9999, 1, 1, 1]);
    await expect(
      proveCompleteness({
        bps: NORTHWIND_OWNERS,
        arrayCommitment: wrongCommitment,
        disclosedCount: NORTHWIND_DISCLOSED_COUNT,
        nonce: "zk-test-nonce-mismatch",
      }),
    ).rejects.toThrow(ZkError);
  });

  it("refuses more than 8 owners", async () => {
    const tooMany = Array.from({ length: 9 }, (_, index) => index);
    const commitment = "0x01";
    await expect(
      proveCompleteness({
        bps: tooMany,
        arrayCommitment: commitment,
        disclosedCount: 1,
        nonce: "zk-test-nonce-too-many",
      }),
    ).rejects.toThrow(ZkError);
  });
});

describe("proveCompleteness - THE COMPLETENESS REGRESSION (undisclosed >= 25% owner is UNSATISFIABLE)", () => {
  it(
    "an undisclosed third owner >= 2500 bps makes the honest disclosedCount=2 claim UNSATISFIABLE",
    async () => {
      // Marcus's 1800 bps is secretly actually 2600 (>= 25%) - a THIRD
      // undisclosed >= 25% owner the business tries to hide by still
      // claiming only 2 disclosed threshold owners.
      const dishonestOwners = [4200, 2800, 2600, 1200] as const;
      const host = stubHost();
      const { arrayCommitment } = await mintArrayAnchor(host, dishonestOwners, 2);
      await expect(
        proveCompleteness({
          bps: dishonestOwners,
          arrayCommitment,
          disclosedCount: NORTHWIND_DISCLOSED_COUNT, // dishonestly still claims 2
          nonce: "zk-test-nonce-undisclosed-owner",
        }),
      ).rejects.toMatchObject({ code: "UNSATISFIABLE" });
    },
    PROVE_TIMEOUT,
  );

  it(
    "an OVERSTATED disclosedCount (claiming 3 when only 2 truly cross the threshold) is also UNSATISFIABLE",
    async () => {
      const host = stubHost();
      const { arrayCommitment } = await mintArrayAnchor(host, NORTHWIND_OWNERS, 3);
      await expect(
        proveCompleteness({
          bps: NORTHWIND_OWNERS,
          arrayCommitment,
          disclosedCount: 3, // overclaims - only Jordan+Priya truly cross 2500
          nonce: "zk-test-nonce-overclaim",
        }),
      ).rejects.toMatchObject({ code: "UNSATISFIABLE" });
    },
    PROVE_TIMEOUT,
  );
});

describe("verifyCompleteness - the negative matrix (every scenario must REJECT)", () => {
  let host: ReturnType<typeof stubHost>;
  let anchor: IssuedCredential;
  let arrayCommitment: string;
  let proof: CompletenessProof;
  const HONEST_NONCE = "zk-test-nonce-completeness-matrix";

  beforeAll(async () => {
    host = stubHost();
    ({ anchor, arrayCommitment } = await mintArrayAnchor(host, NORTHWIND_OWNERS, 5));
    proof = await proveCompleteness({
      bps: NORTHWIND_OWNERS,
      arrayCommitment,
      disclosedCount: NORTHWIND_DISCLOSED_COUNT,
      nonce: HONEST_NONCE,
    });
  }, PROVE_TIMEOUT);

  function baseOptions(
    overrides: Partial<VerifyCompletenessOptions> = {},
  ): VerifyCompletenessOptions {
    return {
      anchorVc: anchor.body,
      webid: SUBJECT,
      nonce: HONEST_NONCE,
      nonces: oneShotNonce(SESSION, HONEST_NONCE),
      sessionKey: SESSION,
      now: NOW,
      trustedIssuers: [ISSUER],
      resolveKey: resolveIssuerKey,
      statusFetch: host.fetch,
      disclosedCount: NORTHWIND_DISCLOSED_COUNT,
      ...overrides,
    };
  }

  it("a claimed disclosedCount different from what the proof was produced for is rejected", async () => {
    const result = await verifyCompleteness(proof, baseOptions({ disclosedCount: 1 }));
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("STATEMENT_MISMATCH");
  });

  it("a claimed threshold different from the proof's is rejected", async () => {
    const result = await verifyCompleteness(proof, baseOptions({ threshold: 3000 }));
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("STATEMENT_MISMATCH");
  });

  it("wrong-field anchor: anchors the per-owner field, not the array commitment", async () => {
    const list = await hostedStatusList(stubHost());
    const wrongFieldAnchor = await issueCredential({
      kind: "zk-operand-anchor",
      credentialId: "https://northwind.pod.example/kyb/credentials/anchors/wrong-field",
      issuer: ISSUER,
      subject: SUBJECT,
      claims: {
        kind: "zk-operand-anchor",
        field: KYB.ownershipPercentageBps,
        operandEnc: arrayCommitment,
      },
      validity: BACKDATED_VALIDITY,
      status: list.entry(41),
      key: await issuerKey(),
    });
    const result = await verifyCompleteness(
      proof,
      baseOptions({ anchorVc: wrongFieldAnchor.body }),
    );
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("ANCHOR_FIELD_MISMATCH");
  });

  it("wrong-subject anchor: anchored to a different WebID than the presenter", async () => {
    const { anchor: foreignAnchor } = await mintArrayAnchorForSubject(
      "https://mallory.example/profile/card#me",
      6,
    );
    const result = await verifyCompleteness(proof, baseOptions({ anchorVc: foreignAnchor.body }));
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("ANCHOR_SUBJECT_MISMATCH");
  });

  async function mintArrayAnchorForSubject(subject: string, index: number) {
    const list = await hostedStatusList(stubHost());
    const commitment = await ownershipArrayCommitment([...NORTHWIND_OWNERS]);
    const anchorCred = await issueCredential({
      kind: "zk-operand-anchor",
      credentialId: `https://northwind.pod.example/kyb/credentials/anchors/foreign-${index}`,
      issuer: ISSUER,
      subject,
      claims: {
        kind: "zk-operand-anchor",
        field: KYB.beneficialOwnershipArrayCommitment,
        operandEnc: commitment,
      },
      validity: BACKDATED_VALIDITY,
      status: list.entry(index),
      key: await issuerKey(),
    });
    return { anchor: anchorCred };
  }

  it("revoked anchor: the issuer set the anchor's status bit", async () => {
    const list = await hostedStatusList(host, {
      url: "https://issuers.example/status/array-revoke-test",
    });
    const revocable = await issueCredential({
      kind: "zk-operand-anchor",
      credentialId: "https://northwind.pod.example/kyb/credentials/anchors/revocable",
      issuer: ISSUER,
      subject: SUBJECT,
      claims: {
        kind: "zk-operand-anchor",
        field: KYB.beneficialOwnershipArrayCommitment,
        operandEnc: arrayCommitment,
      },
      validity: BACKDATED_VALIDITY,
      status: list.entry(9),
      key: await issuerKey(),
    });
    await list.revoke(9, { now: NOW });
    const result = await verifyCompleteness(proof, baseOptions({ anchorVc: revocable.body }));
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("ANCHOR_INVALID");
    expect(result.errors[0]?.message).toContain("STATUS_REVOKED");
  });

  it("wrong nonce: the presented nonce is not the session's live challenge", async () => {
    const result = await verifyCompleteness(proof, {
      ...baseOptions({ nonces: oneShotNonce(SESSION, "a-different-nonce") }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("NONCE_INVALID");
  });

  it("stolen-challenge: a proof produced for ANOTHER nonce, presented with the live one", async () => {
    const live = "freshly-minted-other-nonce-completeness";
    const result = await verifyCompleteness(proof, {
      ...baseOptions({ nonce: live, nonces: oneShotNonce(SESSION, live) }),
    });
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("CHALLENGE_MISMATCH");
  });

  it("tampered proof bytes reject", async () => {
    const tampered = Uint8Array.from(proof.proof);
    tampered[50] = (tampered[50] ?? 0) ^ 0xff;
    const result = await verifyCompleteness({ ...proof, proof: tampered }, baseOptions());
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("PROOF_INVALID");
  });

  it("*-no-zk flavours are rejected before any cryptography runs", async () => {
    for (const flavour of ["evm-no-zk", "noir-recursive-no-zk"]) {
      const result = await verifyCompleteness({ ...proof, verifierTarget: flavour }, baseOptions());
      expect(result.verified).toBe(false);
      expect(result.errors[0]?.code).toBe("FORBIDDEN_FLAVOUR");
    }
  });

  it("the Tier A member is rejected by the Tier B verifier", async () => {
    const result = await verifyCompleteness({ ...proof, member: "filter_int_d4" }, baseOptions());
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("UNKNOWN_MEMBER");
  });

  it("wrong public-input count is rejected", async () => {
    const result = await verifyCompleteness(
      { ...proof, publicInputs: proof.publicInputs.slice(0, 4) },
      baseOptions(),
    );
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("MALFORMED_PROOF");
  });

  it("an omitted/empty issuer allowlist fails closed", async () => {
    const result = await verifyCompleteness(proof, baseOptions({ trustedIssuers: [] }));
    expect(result.verified).toBe(false);
    expect(result.errors[0]?.code).toBe("ANCHOR_INVALID");
    expect(result.checks.structural).toBe(false);
  });

  it("a malformed presentation never burns the nonce (gates 0-1 precede gate 2)", async () => {
    const nonces = oneShotNonce(SESSION, HONEST_NONCE);
    const malformed = await verifyCompleteness(
      { ...proof, proof: new Uint8Array(131_073) },
      baseOptions({ nonces }),
    );
    expect(malformed.verified).toBe(false);
    expect(malformed.errors[0]?.code).toBe("MALFORMED_PROOF");
    const retry = await verifyCompleteness(proof, baseOptions({ nonces }));
    expect(retry.verified).toBe(true);
  });
});

describe("OWNERSHIP_THRESHOLD_BPS", () => {
  it("is pinned to the design's 25% (2500 bps) beneficial-owner threshold", () => {
    expect(OWNERSHIP_THRESHOLD_BPS).toBe(2500);
  });
});
