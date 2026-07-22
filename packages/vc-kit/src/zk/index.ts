/**
 * `@kyb/vc-kit`'s ZK layer (design §4): the beneficial-ownership predicate
 * "no undisclosed beneficial owner holds >= 25%", decomposed into Tier A
 * (live per-owner threshold, sparq `filter_int_d4`) and Tier B (live
 * completeness scan, this package's own bespoke `kyb_completeness_scan_n8`
 * circuit) - PLUS the honesty-panel content and operand-anchor commitment
 * helpers.
 */

export {
  challengeFieldOf,
  executeWitness,
  fieldHexEquals,
  generateProof,
  memberBackend,
  normalizeFieldHex,
  type ProofData,
  prewarm,
  verifyProof,
  ZK_VERIFIER_TARGET,
  ZkError,
  type ZkVerifierTarget,
} from "./backend.ts";
export {
  type CompiledCircuitArtifact,
  type CompletenessMember,
  asCommittedMember,
  asFilterIntMember,
  COMMITTED_FILTER_MEMBERS,
  COMMITTED_MEMBERS,
  type FilterIntMember,
  loadCommittedCircuit,
  memberDigits,
  memberForDigits,
  PINNED_BB_JS_VERSION,
  PINNED_NARGO_VERSION,
  PINNED_NOIR_JS_VERSION,
  type ZkCircuitMember,
} from "./circuits/registry.ts";
export {
  COMPLETENESS_ARRAY_SIZE,
  ownershipArrayCommitment,
  padOwnershipArray,
} from "./commitment.ts";
export { type HonestyItem, ZK_HONESTY, ZK_HONESTY_ITEMS, ZK_TOOLCHAIN } from "./honesty.ts";
export {
  type CompletenessProof,
  OP_CODES,
  OWNERSHIP_THRESHOLD_BPS,
  proveCompleteness,
  type ProveCompletenessOptions,
  proveOwnerThreshold,
  type ProveOwnerThresholdOptions,
  prewarmProver,
  type TierAProof,
} from "./prover.ts";
export {
  type AnchorVerifyOptions,
  type PresentedProof,
  proofFromJson,
  type TierAChecks,
  type TierAStatement,
  type TierAVerifyResult,
  type TierBChecks,
  type TierBVerifyResult,
  type VerifyCompletenessOptions,
  verifyCompleteness,
  type VerifyOwnerThresholdOptions,
  verifyOwnerThreshold,
  type ZkNonceConsumer,
  type ZkVerificationError,
  type ZkVerifyErrorCode,
} from "./verifier.ts";
