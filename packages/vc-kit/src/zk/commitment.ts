/**
 * The Tier B owner-array commitment (design §4 row 2): a Blake3 digest over
 * the big-endian byte encoding of the FULL (fixed-width, zero-padded)
 * beneficial-ownership basis-points array, truncated to a BN254 field element
 * - the exact computation `kyb_completeness_scan_n8` recomputes in-circuit
 * (see its PROVENANCE header). Computed here in JS (via `hash-wasm`'s Blake3,
 * matching Noir's `std::hash::blake3` byte-for-byte - proven by the real
 * end-to-end prove+verify tests) so the issuer can mint a `kyb:ZkOperandAnchor`
 * over `kyb:beneficialOwnershipArrayCommitment` at seed time without touching
 * the Noir toolchain, and so the prover can recompute the SAME value to
 * fail fast (before wasting a witness solve) if a caller passes a stale array.
 */

import { blake3 } from "hash-wasm";
import { ZkError } from "./backend.ts";

/** Fixed width of the hidden owner array the completeness circuit accepts. */
export const COMPLETENESS_ARRAY_SIZE = 8;

/** Bounds a single owner-array slot must respect (u64 in the circuit's ABI). */
function assertU64(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ZkError("BAD_COMMITMENT_INPUT", `${label} must be a non-negative safe integer`);
  }
  return BigInt(value);
}

function beBytesU64(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let remaining = value;
  for (let index = 7; index >= 0; index -= 1) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) {
    throw new ZkError("BAD_COMMITMENT_INPUT", `value ${value} does not fit in a u64`);
  }
  return out;
}

/**
 * Zero-pad `bps` to {@link COMPLETENESS_ARRAY_SIZE} entries (a padding slot's
 * value 0 can never cross a positive threshold, so it can never hide a real
 * owner - see the circuit's PROVENANCE note).
 */
export function padOwnershipArray(bps: readonly number[]): readonly number[] {
  if (bps.length > COMPLETENESS_ARRAY_SIZE) {
    throw new ZkError(
      "TOO_MANY_OWNERS",
      `at most ${COMPLETENESS_ARRAY_SIZE} owners are supported by the committed completeness circuit, got ${bps.length}`,
    );
  }
  const padded = [...bps];
  while (padded.length < COMPLETENESS_ARRAY_SIZE) padded.push(0);
  return padded;
}

/**
 * Compute the array commitment over a (not-yet-padded) owner bps array. This
 * is the value an issuer anchors via `kyb:ZkOperandAnchor` /
 * `kyb:beneficialOwnershipArrayCommitment`, and the value the completeness
 * prover/verifier binds every proof to.
 */
export async function ownershipArrayCommitment(bps: readonly number[]): Promise<string> {
  const padded = padOwnershipArray(bps);
  const bytes = new Uint8Array(COMPLETENESS_ARRAY_SIZE * 8);
  padded.forEach((value, index) => {
    bytes.set(beBytesU64(assertU64(value, `bps[${index}]`)), index * 8);
  });
  const hex = await blake3(bytes, 256);
  const digestBytes = hexToBytes(hex);
  // Truncate to the low 31 bytes (< 2^248, always below the BN254 modulus) -
  // the identical trick `challengeFieldOf` uses, and what the circuit does
  // in-circuit over its own recomputed digest.
  let acc = 0n;
  for (let index = 0; index < 31; index += 1) {
    acc = acc * 256n + BigInt(digestBytes[index] ?? 0);
  }
  return `0x${acc.toString(16).padStart(64, "0")}`;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
