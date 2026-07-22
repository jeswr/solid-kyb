/**
 * Verification for both tiers of design §4's predicate. A bare proof of
 * EITHER tier is FULLY FORGEABLE without its operand anchor: `operandEnc` /
 * the array commitment are deterministic, salt-free computations anyone can
 * reproduce for any value/array, so an adversary could otherwise prove a true
 * statement about fabricated data and present it beside a genuine-looking
 * anchor. Every verification therefore runs ALL of these gates, fail-closed:
 *
 *  0. config      - a non-empty issuer allowlist and a valid `now`;
 *  1. structural   - sanctioned flavour (`evm`), committed member, correct
 *                    public-input count - all checkable WITHOUT touching the
 *                    nonce store, so a malformed presentation never burns a
 *                    live challenge;
 *  2. nonce        - single-use challenge burned via the injected
 *                    {@link ZkNonceConsumer} ONLY once gates 0-1 pass;
 *  3. challenge    - the proof's `challenge` public input equals the burned
 *                    nonce's field derivation;
 *  4. statement    - the remaining public inputs are exactly the advertised
 *                    statement with a TRUE verdict;
 *  5. anchor VC    - verifies via `verifyCredential` with the
 *                    `zk-operand-anchor` shape: issuer signature, issuer
 *                    allowlist, validity window, Bitstring status;
 *  6. subject      - anchor `credentialSubject` IRI === the DPoP-verified
 *                    presenter WebID (holder binding);
 *  7. field        - anchor `kyb:field` === the advertised statement's field;
 *  8. operand      - anchor `kyb:operandEnc` === the proof's public operand
 *                    (constant-time) - the forgeability gate;
 *  9. cryptography - bb.js UltraHonk verify against the COMMITTED artifact.
 *
 * ANY failure rejects.
 */

import { KYB, zkBudgetFor } from "@kyb/data-model";
import { parseCredentialRdf } from "@jeswr/solid-vc";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";
import { ZkOperandAnchorSubject } from "@kyb/data-model";
import type { VerifyCredentialOptions, VerifyCredentialResult } from "../verify.ts";
import { verifyCredential } from "../verify.ts";
import {
  assertZkVerifierTarget,
  challengeFieldOf,
  fieldHexEquals,
  verifyProof,
  type ZkError,
} from "./backend.ts";
import { asCommittedMember, type FilterIntMember, memberDigits } from "./circuits/registry.ts";
import { OP_CODES, OWNERSHIP_THRESHOLD_BPS } from "./prover.ts";

/** The single-use challenge seam - any nonce store satisfying this interface works. */
export interface ZkNonceConsumer {
  /** `true` iff `nonce` is the live challenge for `sessionKey`; burns it. */
  consume(sessionKey: string, nonce: string): boolean;
}

/** Rejection codes shared by both tiers. */
export type ZkVerifyErrorCode =
  | "FORBIDDEN_FLAVOUR"
  | "UNKNOWN_MEMBER"
  | "MALFORMED_PROOF"
  | "UNKNOWN_FIELD"
  | "MEMBER_BUDGET_MISMATCH"
  | "NONCE_INVALID"
  | "CHALLENGE_MISMATCH"
  | "STATEMENT_MISMATCH"
  | "ANCHOR_INVALID"
  | "ANCHOR_SUBJECT_MISMATCH"
  | "ANCHOR_FIELD_MISMATCH"
  | "ANCHOR_OPERAND_MISMATCH"
  | "PROOF_INVALID";

export interface ZkVerificationError {
  readonly code: ZkVerifyErrorCode;
  readonly message: string;
}

/** The presented proof payload (untrusted wire input). */
export interface PresentedProof {
  readonly member: string;
  readonly proof: Uint8Array;
  readonly publicInputs: readonly string[];
  readonly verifierTarget: string;
}

const MAX_PROOF_BYTES = 131_072;
const MAX_WIRE_PUBLIC_INPUTS = 16;
const TRUE_FIELD = 1n;

/** Bounds-checked untrusted-payload parser (structural only; security stays in verify*). */
export function proofFromJson(json: unknown): PresentedProof {
  if (typeof json !== "object" || json === null) {
    throw new TypeError("proof payload is not an object");
  }
  const { member, proof, publicInputs, verifierTarget } = json as Record<string, unknown>;
  if (typeof member !== "string") throw new TypeError("proof payload has no member name");
  if (typeof verifierTarget !== "string")
    throw new TypeError("proof payload has no verifierTarget");
  if (
    !Array.isArray(proof) ||
    proof.length === 0 ||
    proof.length > MAX_PROOF_BYTES ||
    !proof.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    throw new TypeError("proof bytes must be a non-empty, bounded byte array");
  }
  if (
    !Array.isArray(publicInputs) ||
    publicInputs.length > MAX_WIRE_PUBLIC_INPUTS ||
    !publicInputs.every((entry) => typeof entry === "string")
  ) {
    throw new TypeError("publicInputs must be a bounded array of hex strings");
  }
  return {
    member,
    proof: Uint8Array.from(proof as number[]),
    publicInputs: publicInputs as string[],
    verifierTarget,
  };
}

function publicInputBigInt(value: string | undefined): bigint | undefined {
  if (value === undefined || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function checkCallerContract(
  trustedIssuers: readonly string[],
  now: Date,
): ZkVerificationError | undefined {
  if (!Array.isArray(trustedIssuers) || trustedIssuers.length === 0) {
    return {
      code: "ANCHOR_INVALID",
      message:
        "trustedIssuers must be a non-empty allowlist (an omitted allowlist would accept any issuer)",
    };
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return {
      code: "ANCHOR_INVALID",
      message: "now must be a valid Date (a NaN instant would bypass the validity window)",
    };
  }
  return undefined;
}

/** Shared anchor-verification options both tiers' verify functions accept. */
export interface AnchorVerifyOptions {
  readonly anchorVc: string | DatasetCore;
  readonly webid: string;
  readonly nonce: string;
  readonly nonces: ZkNonceConsumer;
  readonly sessionKey: string;
  readonly now: Date;
  readonly trustedIssuers: readonly string[];
  readonly contentType?: string;
  readonly resolveKey?: VerifyCredentialOptions["resolveKey"];
  readonly isControlledBy?: VerifyCredentialOptions["isControlledBy"];
  readonly webIdFetch?: VerifyCredentialOptions["webIdFetch"];
  readonly statusFetch?: VerifyCredentialOptions["statusFetch"];
  readonly trustedStatusIssuers?: VerifyCredentialOptions["trustedStatusIssuers"];
  readonly registry?: VerifyCredentialOptions["registry"];
}

async function verifyAnchor(
  expectedField: string,
  expectedOperandPublicInput: string | undefined,
  options: AnchorVerifyOptions,
): Promise<
  | { readonly ok: true; readonly anchor: VerifyCredentialResult }
  | {
      readonly ok: false;
      readonly error: ZkVerificationError;
      readonly anchor?: VerifyCredentialResult;
    }
> {
  let dataset: DatasetCore;
  if (typeof options.anchorVc === "string") {
    try {
      dataset = await parseCredentialRdf(options.anchorVc, options.contentType ?? "text/turtle");
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "ANCHOR_INVALID",
          message: `anchor document did not parse: ${(error as Error).message}`,
        },
      };
    }
  } else {
    dataset = options.anchorVc;
  }
  const anchor = await verifyCredential(dataset, {
    expectShape: "zk-operand-anchor",
    now: options.now,
    trustedIssuers: options.trustedIssuers,
    ...(options.resolveKey !== undefined ? { resolveKey: options.resolveKey } : {}),
    ...(options.isControlledBy !== undefined ? { isControlledBy: options.isControlledBy } : {}),
    ...(options.webIdFetch !== undefined ? { webIdFetch: options.webIdFetch } : {}),
    ...(options.statusFetch !== undefined ? { statusFetch: options.statusFetch } : {}),
    ...(options.trustedStatusIssuers !== undefined
      ? { trustedStatusIssuers: options.trustedStatusIssuers }
      : {}),
    ...(options.registry !== undefined ? { registry: options.registry } : {}),
  });
  if (!anchor.verified) {
    const detail = anchor.errors.map((error) => `${error.code}: ${error.message}`).join("; ");
    return {
      ok: false,
      error: { code: "ANCHOR_INVALID", message: `operand-anchor VC did not verify: ${detail}` },
      anchor,
    };
  }
  const subject = anchor.credential?.subject;
  if (
    typeof options.webid !== "string" ||
    options.webid.length === 0 ||
    subject !== options.webid
  ) {
    return {
      ok: false,
      error: {
        code: "ANCHOR_SUBJECT_MISMATCH",
        message: "anchor subject WebID is not the authenticated presenter",
      },
      anchor,
    };
  }
  const subjectNode = new ZkOperandAnchorSubject(
    DataFactory.namedNode(subject),
    dataset,
    DataFactory,
  );
  let fieldIri: string | undefined;
  let operandEnc: string | undefined;
  try {
    fieldIri = subjectNode.fieldIri;
    operandEnc = subjectNode.operandEnc;
  } catch {
    // The shape gate already ran (anchor.verified === true); a throw here
    // means the accessor's own invariant was violated some other way -
    // fail closed rather than let it propagate as an uncaught exception.
    return {
      ok: false,
      error: { code: "ANCHOR_INVALID", message: "anchor subject fields could not be read" },
      anchor,
    };
  }
  if (fieldIri !== expectedField) {
    return {
      ok: false,
      error: {
        code: "ANCHOR_FIELD_MISMATCH",
        message: "anchor does not anchor the advertised field",
      },
      anchor,
    };
  }
  if (
    expectedOperandPublicInput === undefined ||
    !fieldHexEquals(operandEnc, expectedOperandPublicInput, "operand_enc")
  ) {
    return {
      ok: false,
      error: {
        code: "ANCHOR_OPERAND_MISMATCH",
        message:
          "proof's public operand is not the issuer-anchored encoding - a bare proof is forgeable",
      },
      anchor,
    };
  }
  return { ok: true, anchor };
}

// -- Tier A: per-owner threshold verify -----------------------------------------------

export interface TierAStatement {
  readonly field: string;
  readonly bound: number;
}

export interface TierAChecks {
  readonly structural: boolean;
  readonly nonce: boolean;
  readonly challenge: boolean;
  readonly statement: boolean;
  readonly anchor: boolean;
  readonly subject: boolean;
  readonly field: boolean;
  readonly operandBinding: boolean;
  readonly proof: boolean;
}

export interface TierAVerifyResult {
  readonly verified: boolean;
  readonly checks: TierAChecks;
  readonly errors: readonly ZkVerificationError[];
  readonly anchor?: VerifyCredentialResult;
}

const NO_TIER_A_CHECKS: TierAChecks = {
  structural: false,
  nonce: false,
  challenge: false,
  statement: false,
  anchor: false,
  subject: false,
  field: false,
  operandBinding: false,
  proof: false,
};

function rejectTierA(
  code: ZkVerifyErrorCode,
  message: string,
  checks: TierAChecks,
): TierAVerifyResult {
  return { verified: false, checks, errors: [{ code, message }] };
}

/** Options for {@link verifyOwnerThreshold}. */
export interface VerifyOwnerThresholdOptions extends AnchorVerifyOptions {
  readonly statement?: TierAStatement;
}

/**
 * Verify a Tier A per-owner threshold proof against its mandatory operand
 * anchor. See the module header for the nine fail-closed gates.
 */
export async function verifyOwnerThreshold(
  presented: PresentedProof,
  options: VerifyOwnerThresholdOptions,
): Promise<TierAVerifyResult> {
  const statement = options.statement ?? {
    field: KYB.ownershipPercentageBps,
    bound: OWNERSHIP_THRESHOLD_BPS,
  };

  const configRejection = checkCallerContract(options.trustedIssuers, options.now);
  if (configRejection !== undefined)
    return rejectTierA(configRejection.code, configRejection.message, NO_TIER_A_CHECKS);

  // Gate 1: structural (before the nonce is ever touched).
  try {
    assertZkVerifierTarget(presented.verifierTarget);
  } catch (error) {
    return rejectTierA("FORBIDDEN_FLAVOUR", (error as ZkError).message, NO_TIER_A_CHECKS);
  }
  const member = asCommittedMember(presented.member);
  if (member === undefined || !member.startsWith("filter_int_")) {
    return rejectTierA(
      "UNKNOWN_MEMBER",
      `"${presented.member}" is not a committed Tier A member`,
      NO_TIER_A_CHECKS,
    );
  }
  const filterMember = member as FilterIntMember;
  if (presented.publicInputs.length !== 5) {
    return rejectTierA(
      "MALFORMED_PROOF",
      `expected 5 public inputs, got ${presented.publicInputs.length}`,
      NO_TIER_A_CHECKS,
    );
  }
  if (presented.proof.length === 0 || presented.proof.length > MAX_PROOF_BYTES) {
    return rejectTierA("MALFORMED_PROOF", "proof bytes are empty or oversized", NO_TIER_A_CHECKS);
  }
  const budget = zkBudgetFor(statement.field);
  if (budget === undefined) {
    return rejectTierA(
      "UNKNOWN_FIELD",
      `statement field ${statement.field} is not ZK-provable`,
      NO_TIER_A_CHECKS,
    );
  }
  if (memberDigits(filterMember) > budget.digits) {
    return rejectTierA(
      "MEMBER_BUDGET_MISMATCH",
      `${filterMember} exceeds the ${budget.digits}-digit budget of ${budget.key}`,
      NO_TIER_A_CHECKS,
    );
  }

  // Gate 2: burn the single-use challenge.
  if (!options.nonces.consume(options.sessionKey, options.nonce)) {
    return rejectTierA(
      "NONCE_INVALID",
      "challenge is not the live, unexpired, unconsumed nonce for this session",
      {
        ...NO_TIER_A_CHECKS,
        structural: true,
      },
    );
  }
  let checks: TierAChecks = { ...NO_TIER_A_CHECKS, structural: true, nonce: true };

  // Gate 3: challenge.
  const expectedChallenge = await challengeFieldOf(options.nonce);
  const challengeInput = presented.publicInputs[0];
  if (
    challengeInput === undefined ||
    !fieldHexEquals(challengeInput, expectedChallenge, "challenge")
  ) {
    return rejectTierA(
      "CHALLENGE_MISMATCH",
      "proof was not produced for this session's challenge",
      checks,
    );
  }
  checks = { ...checks, challenge: true };

  // Gate 4: statement (op/bound/expected).
  const op = publicInputBigInt(presented.publicInputs[2]);
  const bound = publicInputBigInt(presented.publicInputs[3]);
  const expected = publicInputBigInt(presented.publicInputs[4]);
  if (op !== BigInt(OP_CODES.ge) || bound !== BigInt(statement.bound) || expected !== TRUE_FIELD) {
    return rejectTierA(
      "STATEMENT_MISMATCH",
      "proof public inputs do not match the advertised statement",
      checks,
    );
  }
  checks = { ...checks, statement: true };

  // Gates 5-8: the anchor. `verifyAnchor` runs signature/shape/status (gate 5),
  // subject binding (gate 6), field match (gate 7) and operand equality
  // (gate 8) in that order and reports the FIRST failure - `checks` below
  // stays at its pre-anchor-gate state on failure (honest: we do not know
  // which of 5-8 passed before the reported one failed).
  const operandInput = presented.publicInputs[1];
  const anchorResult = await verifyAnchor(statement.field, operandInput, options);
  if (!anchorResult.ok) {
    return {
      verified: false,
      checks,
      errors: [anchorResult.error],
      ...(anchorResult.anchor !== undefined ? { anchor: anchorResult.anchor } : {}),
    };
  }
  checks = { ...checks, anchor: true, subject: true, field: true, operandBinding: true };

  // Gate 9: cryptography.
  let proofOk = false;
  try {
    proofOk = await verifyProof(filterMember, {
      proof: presented.proof,
      publicInputs: presented.publicInputs,
    });
  } catch {
    proofOk = false;
  }
  if (!proofOk) {
    return {
      verified: false,
      checks,
      errors: [{ code: "PROOF_INVALID", message: "UltraHonk proof did not verify" }],
      anchor: anchorResult.anchor,
    };
  }
  checks = { ...checks, proof: true };

  const verified = Object.values(checks).every((passed) => passed === true);
  return { verified, checks, errors: [], anchor: anchorResult.anchor };
}

// -- Tier B: completeness verify -------------------------------------------------------

export interface TierBChecks {
  readonly structural: boolean;
  readonly nonce: boolean;
  readonly challenge: boolean;
  readonly statement: boolean;
  readonly anchor: boolean;
  readonly subject: boolean;
  readonly field: boolean;
  readonly operandBinding: boolean;
  readonly proof: boolean;
}

export interface TierBVerifyResult {
  readonly verified: boolean;
  readonly checks: TierBChecks;
  readonly errors: readonly ZkVerificationError[];
  readonly anchor?: VerifyCredentialResult;
}

const NO_TIER_B_CHECKS: TierBChecks = { ...NO_TIER_A_CHECKS };

function rejectTierB(
  code: ZkVerifyErrorCode,
  message: string,
  checks: TierBChecks,
): TierBVerifyResult {
  return { verified: false, checks, errors: [{ code, message }] };
}

export interface VerifyCompletenessOptions extends AnchorVerifyOptions {
  /** The threshold in basis points. Default {@link OWNERSHIP_THRESHOLD_BPS}. */
  readonly threshold?: number;
  /** The disclosed count the bank was told to expect (>= 1 disclosed owner in this demo). */
  readonly disclosedCount: number;
}

/**
 * Verify a Tier B completeness proof (this package's bespoke
 * `kyb_completeness_scan_n8` circuit) against its mandatory operand anchor
 * (`kyb:beneficialOwnershipArrayCommitment`). Mirrors {@link verifyOwnerThreshold}'s
 * gate ordering, adapted to the completeness statement's public inputs
 * (`[challenge, array_commitment, threshold, disclosed_count, expected]`).
 */
export async function verifyCompleteness(
  presented: PresentedProof,
  options: VerifyCompletenessOptions,
): Promise<TierBVerifyResult> {
  const threshold = options.threshold ?? OWNERSHIP_THRESHOLD_BPS;

  const configRejection = checkCallerContract(options.trustedIssuers, options.now);
  if (configRejection !== undefined)
    return rejectTierB(configRejection.code, configRejection.message, NO_TIER_B_CHECKS);

  // Gate 1: structural.
  try {
    assertZkVerifierTarget(presented.verifierTarget);
  } catch (error) {
    return rejectTierB("FORBIDDEN_FLAVOUR", (error as ZkError).message, NO_TIER_B_CHECKS);
  }
  if (
    presented.member !== "kyb_completeness_scan_n8" ||
    asCommittedMember(presented.member) === undefined
  ) {
    return rejectTierB(
      "UNKNOWN_MEMBER",
      `"${presented.member}" is not the committed Tier B member`,
      NO_TIER_B_CHECKS,
    );
  }
  if (presented.publicInputs.length !== 5) {
    return rejectTierB(
      "MALFORMED_PROOF",
      `expected 5 public inputs, got ${presented.publicInputs.length}`,
      NO_TIER_B_CHECKS,
    );
  }
  if (presented.proof.length === 0 || presented.proof.length > MAX_PROOF_BYTES) {
    return rejectTierB("MALFORMED_PROOF", "proof bytes are empty or oversized", NO_TIER_B_CHECKS);
  }

  // Gate 2: burn the single-use challenge.
  if (!options.nonces.consume(options.sessionKey, options.nonce)) {
    return rejectTierB(
      "NONCE_INVALID",
      "challenge is not the live, unexpired, unconsumed nonce for this session",
      {
        ...NO_TIER_B_CHECKS,
        structural: true,
      },
    );
  }
  let checks: TierBChecks = { ...NO_TIER_B_CHECKS, structural: true, nonce: true };

  // Gate 3: challenge.
  const expectedChallenge = await challengeFieldOf(options.nonce);
  const challengeInput = presented.publicInputs[0];
  if (
    challengeInput === undefined ||
    !fieldHexEquals(challengeInput, expectedChallenge, "challenge")
  ) {
    return rejectTierB(
      "CHALLENGE_MISMATCH",
      "proof was not produced for this session's challenge",
      checks,
    );
  }
  checks = { ...checks, challenge: true };

  // Gate 4: statement (threshold/disclosed_count/expected).
  const thresholdInput = publicInputBigInt(presented.publicInputs[2]);
  const disclosedCountInput = publicInputBigInt(presented.publicInputs[3]);
  const expectedInput = publicInputBigInt(presented.publicInputs[4]);
  if (
    thresholdInput !== BigInt(threshold) ||
    disclosedCountInput !== BigInt(options.disclosedCount) ||
    expectedInput !== TRUE_FIELD
  ) {
    return rejectTierB(
      "STATEMENT_MISMATCH",
      "proof public inputs do not match the advertised statement",
      checks,
    );
  }
  checks = { ...checks, statement: true };

  // Gates 5-8: the anchor (kyb:beneficialOwnershipArrayCommitment).
  const commitmentInput = presented.publicInputs[1];
  const anchorResult = await verifyAnchor(
    KYB.beneficialOwnershipArrayCommitment,
    commitmentInput,
    options,
  );
  if (!anchorResult.ok) {
    return {
      verified: false,
      checks,
      errors: [anchorResult.error],
      ...(anchorResult.anchor !== undefined ? { anchor: anchorResult.anchor } : {}),
    };
  }
  checks = { ...checks, anchor: true, subject: true, field: true, operandBinding: true };

  // Gate 9: cryptography.
  let proofOk = false;
  try {
    proofOk = await verifyProof("kyb_completeness_scan_n8", {
      proof: presented.proof,
      publicInputs: presented.publicInputs,
    });
  } catch {
    proofOk = false;
  }
  if (!proofOk) {
    return {
      verified: false,
      checks,
      errors: [{ code: "PROOF_INVALID", message: "UltraHonk proof did not verify" }],
      anchor: anchorResult.anchor,
    };
  }
  checks = { ...checks, proof: true };

  const verified = Object.values(checks).every((passed) => passed === true);
  return { verified, checks, errors: [], anchor: anchorResult.anchor };
}
