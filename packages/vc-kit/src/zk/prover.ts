/**
 * Live prove/verify for the design §4 predicate "no undisclosed beneficial
 * owner holds >= 25%", decomposed into:
 *
 *  - Tier A ({@link proveOwnerThreshold}): per-owner live threshold proof over
 *    `kyb:ownershipPercentageBps >= 2500` (the sparq `filter_int_d4` circuit -
 *    the SAME committed circuit family the mortgage/lending showcases use).
 *  - Tier B ({@link proveCompleteness}): this package's own bespoke, LIVE
 *    completeness-scan circuit (`kyb_completeness_scan_n8`) - see its
 *    PROVENANCE header and zk/honesty.ts for the full scope note.
 *
 * private witness (Tier A): the hidden owner's exact decimal digits, never
 * disclosed. private witness (Tier B): the FULL hidden owner-array (all
 * owners, disclosed or not), never disclosed - only a commitment and a count
 * are public.
 *
 * Both circuits bind the hidden witness to an issuer-anchored public operand
 * (`operandEnc` / `arrayCommitment`), so a false claim is UNSATISFIABLE - the
 * witness solve throws and no proof exists (the honest "you cannot forge
 * eligibility / completeness" outcome).
 */

import { fitsZkBudget, KYB, zkBudgetFor } from "@kyb/data-model";
import {
  challengeFieldOf,
  executeWitness,
  generateProof,
  normalizeFieldHex,
  prewarm,
  ZK_VERIFIER_TARGET,
  ZkError,
  type ZkVerifierTarget,
} from "./backend.ts";
import type { FilterIntMember } from "./circuits/registry.ts";
import { memberForDigits } from "./circuits/registry.ts";
import {
  COMPLETENESS_ARRAY_SIZE,
  ownershipArrayCommitment,
  padOwnershipArray,
} from "./commitment.ts";

/** sparq `filter_int` comparison-operator codes (zk/compose ABI); this demo only needs `ge`. */
export const OP_CODES = Object.freeze({ ge: 3, eq: 4 });

/** A produced Tier A proof - the wire payload for the VP-POST-style rail. */
export interface TierAProof {
  readonly member: FilterIntMember;
  /** The UltraHonk transcript (~8.4 kB, `evm` flavour, fully zero-knowledge). */
  readonly proof: Uint8Array;
  /** [challenge, operand_enc, op, bound, expected] as 32-byte 0x-hex. */
  readonly publicInputs: readonly string[];
  readonly verifierTarget: ZkVerifierTarget;
  readonly proveMs: number;
}

/** Options for {@link proveOwnerThreshold}. */
export interface ProveOwnerThresholdOptions {
  /** The HIDDEN owner's ownershipPercentageBps value. Never leaves the device. */
  readonly value: number;
  /** `kyb:operandEnc` from the owner's `kyb:ZkOperandAnchor` (field: ownershipPercentageBps). */
  readonly operandEnc: string;
  /** The bank-minted single-use challenge nonce. */
  readonly nonce: string;
  /** The public threshold in basis points. Default {@link OWNERSHIP_THRESHOLD_BPS} (2500 = 25%). */
  readonly bound?: number;
}

/** The design's pinned 25% beneficial-owner threshold, in basis points. */
export const OWNERSHIP_THRESHOLD_BPS = 2500;

/**
 * Pre-warm the Tier A + Tier B provers (dynamic imports + WASM instantiate +
 * committed artifacts) on route mount so the first "prove" click pays no cold
 * start. Safe to call repeatedly.
 */
export function prewarmProver(): Promise<unknown> {
  return prewarm(["filter_int_d4", "kyb_completeness_scan_n8"]);
}

/**
 * Prove a single owner's `ownershipPercentageBps >= bound` (Tier A). Fail-
 * closed gates BEFORE any proving work:
 *
 *  1. `value`/`bound` must fit the field's digit budget ({@link fitsZkBudget});
 *  2. the value's exact digit count must have a committed circuit member;
 *  3. `operandEnc` must be field-shaped hex.
 *
 * A below-threshold value makes the circuit UNSATISFIABLE: noir_js throws
 * from the witness solve and this function rethrows a `ZkError` with code
 * `UNSATISFIABLE`.
 */
export async function proveOwnerThreshold(
  options: ProveOwnerThresholdOptions,
): Promise<TierAProof> {
  const field = KYB.ownershipPercentageBps;
  const bound = options.bound ?? OWNERSHIP_THRESHOLD_BPS;
  const budget = zkBudgetFor(field);
  if (budget === undefined) {
    throw new ZkError("UNKNOWN_FIELD", `field ${field} is not a ZK-provable KYB field`);
  }
  if (!fitsZkBudget(field, options.value)) {
    throw new ZkError(
      "BUDGET_VIOLATION",
      `hidden value does not fit the ${budget.digits}-digit budget [${budget.minInclusive}, ${budget.maxInclusive}] for ${budget.key}`,
    );
  }
  if (!fitsZkBudget(field, bound)) {
    throw new ZkError(
      "BUDGET_VIOLATION",
      `bound ${bound} does not fit the budget [${budget.minInclusive}, ${budget.maxInclusive}] for ${budget.key}`,
    );
  }
  const digits = String(options.value);
  const member = memberForDigits(digits.length);
  if (member === undefined) {
    throw new ZkError(
      "NO_COMMITTED_MEMBER",
      `no committed filter_int member for a ${digits.length}-digit operand`,
    );
  }
  const operandEnc = normalizeFieldHex(options.operandEnc, "operandEnc");
  const challenge = await challengeFieldOf(options.nonce);

  const inputs = {
    challenge,
    operand_enc: operandEnc,
    op: String(OP_CODES.ge),
    bound: String(bound),
    expected: true,
    // PRIVATE - the exact hidden value, as ASCII digit bytes. Never disclosed.
    digits: [...digits].map((char) => String(char.charCodeAt(0))),
  };

  let witness: Uint8Array;
  try {
    witness = await executeWitness(member, inputs);
  } catch (error) {
    throw new ZkError(
      "UNSATISFIABLE",
      `no witness exists for this statement (a false claim cannot be proved): ${(error as Error).message}`,
    );
  }

  const started = Date.now();
  const produced = await generateProof(member, witness);
  return {
    member,
    proof: produced.proof,
    publicInputs: [...produced.publicInputs],
    verifierTarget: ZK_VERIFIER_TARGET,
    proveMs: Date.now() - started,
  };
}

// -- Tier B: the completeness-scan proof ---------------------------------------------

/** A produced Tier B proof. */
export interface CompletenessProof {
  readonly member: "kyb_completeness_scan_n8";
  readonly proof: Uint8Array;
  /** [challenge, array_commitment, threshold, disclosed_count, expected] as 0x-hex. */
  readonly publicInputs: readonly string[];
  readonly verifierTarget: ZkVerifierTarget;
  readonly proveMs: number;
}

/** Options for {@link proveCompleteness}. */
export interface ProveCompletenessOptions {
  /**
   * The FULL hidden owner array (every owner, disclosed or not; <= 8 owners).
   * Never disclosed - only a commitment and the disclosed count are public.
   */
  readonly bps: readonly number[];
  /**
   * `kyb:operandEnc` from the business's `kyb:ZkOperandAnchor` over
   * `kyb:beneficialOwnershipArrayCommitment` - the issuer-anchored commitment
   * to the SAME array (in the SAME zero-padded order) this proves over.
   */
  readonly arrayCommitment: string;
  /** How many of the hidden owners the business is disclosing as >= threshold. */
  readonly disclosedCount: number;
  /** The threshold in basis points. Default {@link OWNERSHIP_THRESHOLD_BPS}. */
  readonly threshold?: number;
  /** The bank-minted single-use challenge nonce (SHARED with the Tier A legs). */
  readonly nonce: string;
}

/**
 * Prove Tier B's completeness statement: "of the (hidden) full owner array,
 * EXACTLY `disclosedCount` entries are >= `threshold`." Fail-closed gates
 * BEFORE any proving work: the array must fit the committed 8-slot width, and
 * the RECOMPUTED commitment over the (zero-padded) array must equal the
 * supplied anchor commitment (a stale/foreign anchor fails here, client-side,
 * before anything is sent). A false claim - an undisclosed >= threshold owner,
 * or an overstated `disclosedCount` - makes the circuit UNSATISFIABLE.
 */
export async function proveCompleteness(
  options: ProveCompletenessOptions,
): Promise<CompletenessProof> {
  if (options.bps.length > COMPLETENESS_ARRAY_SIZE) {
    throw new ZkError(
      "TOO_MANY_OWNERS",
      `at most ${COMPLETENESS_ARRAY_SIZE} owners are supported, got ${options.bps.length}`,
    );
  }
  const threshold = options.threshold ?? OWNERSHIP_THRESHOLD_BPS;
  const padded = padOwnershipArray(options.bps);
  const recomputed = await ownershipArrayCommitment(options.bps);
  const anchored = normalizeFieldHex(options.arrayCommitment, "arrayCommitment");
  if (normalizeFieldHex(recomputed, "recomputed commitment") !== anchored) {
    throw new ZkError(
      "ANCHOR_MISMATCH",
      "the supplied owner array does not match the anchored kyb:beneficialOwnershipArrayCommitment " +
        "- refusing to prove over an array the issuer never anchored",
    );
  }
  if (
    !Number.isSafeInteger(options.disclosedCount) ||
    options.disclosedCount < 0 ||
    options.disclosedCount > COMPLETENESS_ARRAY_SIZE
  ) {
    throw new ZkError(
      "BAD_DISCLOSED_COUNT",
      `disclosedCount must be an integer in [0, ${COMPLETENESS_ARRAY_SIZE}]`,
    );
  }

  const challenge = await challengeFieldOf(options.nonce);
  const inputs = {
    challenge,
    array_commitment: anchored,
    threshold: String(threshold),
    disclosed_count: String(options.disclosedCount),
    expected: true,
    // PRIVATE - the full hidden owner array. Never disclosed.
    bps: padded.map(String),
  };

  let witness: Uint8Array;
  try {
    witness = await executeWitness("kyb_completeness_scan_n8", inputs);
  } catch (error) {
    throw new ZkError(
      "UNSATISFIABLE",
      `no witness exists for this completeness statement (an undisclosed threshold owner, or an ` +
        `overstated disclosed count, cannot be proved): ${(error as Error).message}`,
    );
  }

  const started = Date.now();
  const produced = await generateProof("kyb_completeness_scan_n8", witness);
  return {
    member: "kyb_completeness_scan_n8",
    proof: produced.proof,
    publicInputs: [...produced.publicInputs],
    verifierTarget: ZK_VERIFIER_TARGET,
    proveMs: Date.now() - started,
  };
}
