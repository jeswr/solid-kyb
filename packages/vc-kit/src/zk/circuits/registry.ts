/**
 * The COMMITTED circuit registry (design §4; decision 0005/0012 postures
 * carried over from the mortgage/lending showcases). Every proof verifies
 * ONLY against circuit artifacts committed in this package — never against
 * caller- or network-supplied bytecode: the verification key is derived from
 * the artifact, so accepting foreign bytecode would let a presenter choose
 * the very circuit their proof is checked against.
 *
 * Artifacts are lazy-loaded via dynamic import so the circuit modules stay
 * out of bundles until a prove/verify actually happens.
 *
 * Two families are committed:
 *  - `filter_int_d1..d4` — the sparq `zk/compose` per-owner threshold family
 *    (Tier A, design §4 row 1: `kyb:ownershipPercentageBps >= 2500`),
 *    byte-identical artifacts to the mortgage/lending showcases' own
 *    committed set (same pinned checkout, same toolchain — see each file's
 *    PROVENANCE header). `filter_int_d4` is the only member this demo's
 *    4-digit ownership-bps budget needs, but d1-d3 are committed too so a
 *    future ZK field with a narrower budget does not need a fresh capture.
 *  - `kyb_completeness_scan_n8` — this package's OWN bespoke Tier B circuit
 *    (design §4 row 2, scoped down per the design's own explicitly-sanctioned
 *    fallback — see its PROVENANCE header for the full honesty note).
 */

/** The compiled-circuit artifact surface this package consumes. */
export interface CompiledCircuitArtifact {
  /** `nargo --version` string baked into the artifact at compile time. */
  readonly noir_version: string;
  /** Base64 ACIR bytecode - the input `UltraHonkBackend` derives the VK from. */
  readonly bytecode: string;
  /** The ABI (parameter names/types/visibility) noir_js encodes inputs with. */
  readonly abi: unknown;
}

/** The pinned toolchain (matches the mortgage/lending showcases' decision 0005 pin). */
export const PINNED_NARGO_VERSION = "1.0.0-beta.21";
export const PINNED_NOIR_JS_VERSION = "1.0.0-beta.21";
export const PINNED_BB_JS_VERSION = "5.0.0-nightly.20260324";

/** The Tier A filter members this package commits. */
export type FilterIntMember = "filter_int_d1" | "filter_int_d2" | "filter_int_d3" | "filter_int_d4";

/** The Tier B completeness-scan member this package commits. */
export type CompletenessMember = "kyb_completeness_scan_n8";

/** Every committed circuit member (Tier A + Tier B). */
export type ZkCircuitMember = FilterIntMember | CompletenessMember;

interface MemberEntry {
  readonly digits: 1 | 2 | 3 | 4 | undefined;
  readonly load: () => Promise<CompiledCircuitArtifact>;
}

const MEMBERS: Readonly<Record<ZkCircuitMember, MemberEntry>> = {
  filter_int_d1: {
    digits: 1,
    load: async () => (await import("./filter-int-d1.ts")).FilterIntD1,
  },
  filter_int_d2: {
    digits: 2,
    load: async () => (await import("./filter-int-d2.ts")).FilterIntD2,
  },
  filter_int_d3: {
    digits: 3,
    load: async () => (await import("./filter-int-d3.ts")).FilterIntD3,
  },
  filter_int_d4: {
    digits: 4,
    load: async () => (await import("./filter-int-d4.ts")).FilterIntD4,
  },
  kyb_completeness_scan_n8: {
    digits: undefined,
    load: async () => (await import("./kyb-completeness-scan-n8.ts")).KybCompletenessScanN8,
  },
};

/** The committed Tier A member names, in digit order. */
export const COMMITTED_FILTER_MEMBERS: readonly FilterIntMember[] = [
  "filter_int_d1",
  "filter_int_d2",
  "filter_int_d3",
  "filter_int_d4",
];

/** Every committed member name (Tier A + Tier B). */
export const COMMITTED_MEMBERS: readonly ZkCircuitMember[] = [
  ...COMMITTED_FILTER_MEMBERS,
  "kyb_completeness_scan_n8",
];

/**
 * Strict committed-membership check: the EXACT member name or nothing.
 * Anything else - unknown members, `*-no-zk` spellings, path tricks - maps to
 * `undefined` and the caller fails closed.
 */
export function asCommittedMember(name: string): ZkCircuitMember | undefined {
  return Object.hasOwn(MEMBERS, name) ? (name as ZkCircuitMember) : undefined;
}

/** Strict Tier A (filter_int) membership check. */
export function asFilterIntMember(name: string): FilterIntMember | undefined {
  return COMMITTED_FILTER_MEMBERS.includes(name as FilterIntMember)
    ? (name as FilterIntMember)
    : undefined;
}

/** Decimal-digit count of a committed Tier A member's private witness. */
export function memberDigits(member: FilterIntMember): 1 | 2 | 3 | 4 {
  const digits = MEMBERS[member].digits;
  if (digits === undefined) throw new Error(`unreachable: ${member} has no digit width`);
  return digits;
}

/** The committed Tier A member whose digit width is exactly `digits`, if any. */
export function memberForDigits(digits: number): FilterIntMember | undefined {
  return COMMITTED_FILTER_MEMBERS.find((member) => MEMBERS[member].digits === digits);
}

/**
 * Load a committed circuit artifact, asserting the compile-time toolchain pin
 * (an artifact regenerated with a different nargo would silently change the
 * verification key - the pin covers the whole chain).
 */
export async function loadCommittedCircuit(
  member: ZkCircuitMember,
): Promise<CompiledCircuitArtifact> {
  const artifact = await MEMBERS[member].load();
  assertCircuitArtifact(artifact, member);
  return artifact;
}

/**
 * Structural + toolchain-pin gate for a circuit artifact. Throws on anything
 * malformed.
 */
export function assertCircuitArtifact(
  artifact: CompiledCircuitArtifact,
  label: string,
): asserts artifact is CompiledCircuitArtifact {
  if (typeof artifact !== "object" || artifact === null) {
    throw new Error(`circuit artifact ${label} is not an object`);
  }
  if (typeof artifact.bytecode !== "string" || artifact.bytecode.length === 0) {
    throw new Error(`circuit artifact ${label} has no bytecode`);
  }
  if (
    typeof artifact.noir_version !== "string" ||
    !artifact.noir_version.startsWith(PINNED_NARGO_VERSION)
  ) {
    throw new Error(
      `circuit artifact ${label} was compiled with "${String(
        (artifact as { noir_version?: unknown }).noir_version,
      )}" - expected the pinned nargo ${PINNED_NARGO_VERSION}`,
    );
  }
}
