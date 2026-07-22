/**
 * `@kyb/vc-kit/seed-tooling` - Node-only seed-time helpers (never imported
 * from the browser-safe root export): anchor minting (`mintOperandAnchors`
 * equivalent, design §4) and the native sparq `encode_int_literal` bridge
 * for Tier A operand anchors.
 */

export {
  mintArrayCommitmentAnchor,
  mintOwnershipBpsAnchor,
  mintZkOperandAnchor,
  type MintAnchorOptions,
} from "./anchors.ts";
export {
  SeedToolingError,
  SparqEncodeHelper,
  type SparqEncodeHelperOptions,
  type SparqEncodeJob,
  type SparqEncodeResult,
  type SparqNativeBridge,
  sparqEncodeHelperFromEnv,
} from "./native.ts";
