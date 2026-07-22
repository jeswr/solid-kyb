/**
 * Scene 3 "prove ownership without exposing the cap table": Northwind's Tier A per-owner
 * threshold proof and Tier B completeness proof (design §4), genuinely proved with
 * `@kyb/vc-kit`'s sparq UltraHonk prover and immediately checked with its real fail-closed
 * verifier.
 *
 * KNOWN DEMO-SCOPE LIMITATION (disclosed, not hidden — see the honesty panel and
 * `./kyb-issuance.ts`'s header): there is no live bank rail in this repo yet to VP-POST to
 * (`bank-credit` is a future build round), so this module stands in as BOTH challenger and
 * verifier — a self-check the demo narrates honestly rather than a real bank's own
 * `/api/prequal/verify`. The PROOFS THEMSELVES, the anchor bindings, and the verifiers' nine
 * fail-closed gates are never mocked. `@kyb/vc-kit` cannot be bundled into a browser build —
 * this rail is browser-TRIGGERED, proving/verifying server-side, mirroring `./dev-seed.ts`.
 */
import {
  type CompletenessProof,
  OWNERSHIP_THRESHOLD_BPS,
  proveCompleteness,
  proveOwnerThreshold,
  type TierAProof,
  type TierAVerifyResult,
  type TierBVerifyResult,
  verifyCompleteness,
  verifyOwnerThreshold,
  ZkError,
} from "@kyb/vc-kit";
import { TIER_A_SAMPLE_BPS } from "./kyb-issuance";
import { mintChallenge, nonceConsumer } from "./zk-nonces";
import { readZkWitnesses } from "./zk-witness";

/** Mint one independent single-use challenge PER TIER (each tier's verify call burns its
 * own nonce, so sharing one across both tiers would fail the second verify). */
export function issueChallenge(now: () => Date = () => new Date()): ZkChallenge {
  return { tierA: mintChallenge(now), tierB: mintChallenge(now) };
}

export class ZkServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface ZkChallengePair {
  readonly sessionKey: string;
  readonly nonce: string;
}

export interface ZkChallenge {
  readonly tierA: ZkChallengePair;
  readonly tierB: ZkChallengePair;
}

export interface ProveAndVerifyOptions {
  readonly podBase: string;
  readonly webid: string;
  readonly challenge: ZkChallenge;
  readonly now: Date;
  readonly fetchImpl?: typeof fetch;
}

export interface ProveAndVerifyResult {
  readonly tierA: {
    readonly proof: TierAProof;
    readonly verification: TierAVerifyResult;
    readonly proveMs: number;
  };
  readonly tierB: {
    readonly proof: CompletenessProof;
    readonly verification: TierBVerifyResult;
    readonly proveMs: number;
  };
}

/**
 * Prove, then immediately verify, both tiers of the beneficial-ownership predicate — a
 * below-threshold/mismatched witness makes the prove call itself throw (`UNSATISFIABLE`):
 * the honest "you cannot forge eligibility/completeness" outcome, never a false-positive
 * proof.
 */
export async function proveAndVerify(
  options: ProveAndVerifyOptions,
): Promise<ProveAndVerifyResult> {
  const witnesses = await readZkWitnesses({
    podBase: options.podBase,
    now: options.now,
    ownershipThresholdBps: OWNERSHIP_THRESHOLD_BPS,
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });

  let tierAProof: TierAProof;
  try {
    tierAProof = await proveOwnerThreshold({
      value: TIER_A_SAMPLE_BPS,
      operandEnc: witnesses.sampleOwner.operandEnc,
      nonce: options.challenge.tierA.nonce,
    });
  } catch (error) {
    if (error instanceof ZkError) {
      throw new ZkServiceError(`Tier A proof failed: ${error.message}`, 422);
    }
    throw error;
  }

  let tierBProof: CompletenessProof;
  try {
    tierBProof = await proveCompleteness({
      bps: witnesses.ownershipBps,
      arrayCommitment: witnesses.arrayCommitment.operandEnc,
      disclosedCount: witnesses.disclosedCount,
      nonce: options.challenge.tierB.nonce,
    });
  } catch (error) {
    if (error instanceof ZkError) {
      throw new ZkServiceError(`Tier B proof failed: ${error.message}`, 422);
    }
    throw error;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  // webIdFetch/statusFetch MUST be explicit: solid-vc's default is an SSRF-guarded fetch
  // that refuses loopback http outright — this dev pod is plain loopback http by design.
  const [tierAVerification, tierBVerification] = await Promise.all([
    verifyOwnerThreshold(tierAProof, {
      anchorVc: witnesses.sampleOwner.anchorTurtle,
      webid: options.webid,
      nonce: options.challenge.tierA.nonce,
      nonces: nonceConsumer,
      sessionKey: options.challenge.tierA.sessionKey,
      now: options.now,
      trustedIssuers: [issuerFrom(options.podBase)],
      webIdFetch: fetchImpl,
      statusFetch: fetchImpl,
    }),
    verifyCompleteness(tierBProof, {
      anchorVc: witnesses.arrayCommitment.anchorTurtle,
      webid: options.webid,
      nonce: options.challenge.tierB.nonce,
      nonces: nonceConsumer,
      sessionKey: options.challenge.tierB.sessionKey,
      now: options.now,
      trustedIssuers: [issuerFrom(options.podBase)],
      disclosedCount: witnesses.disclosedCount,
      webIdFetch: fetchImpl,
      statusFetch: fetchImpl,
    }),
  ]);

  return {
    tierA: { proof: tierAProof, verification: tierAVerification, proveMs: tierAProof.proveMs },
    tierB: { proof: tierBProof, verification: tierBVerification, proveMs: tierBProof.proveMs },
  };
}

function issuerFrom(podBase: string): string {
  return `${podBase}kyb/issuers/beneficial-ownership#id`;
}
