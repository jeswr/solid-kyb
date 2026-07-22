import { KYB } from "./vocab/kyb.ts";

/**
 * The scaled-unit / digit-budget table for the ONE KYB ZK field (design §4):
 * `ownershipPercentageBps >= 2500` — the CDD Rule's 25% beneficial-owner
 * threshold, proved per-owner (Tier A) and composed into the disclosed-set
 * completeness predicate (Tier B, precomputed offline / verified live,
 * per the design's fallback posture). This is a plain xsd:integer in basis
 * points; the SHACL shape pins the identical bounds (test-enforced, no
 * drift).
 *
 * The bound gives the sparq filter circuit its operand width statically:
 * seeded fixture values MUST respect it. `filter_int_d4` is a member of the
 * pinned sparq checkout's zk/compose workspace (design §4's circuit table);
 * the Tier-A prover that consumes it is a later build round.
 */
export interface ZkFieldBudget {
  /** Constant key in the KYB vocabulary map. */
  readonly key: "ownershipPercentageBps";
  /** Full IRI of the field (kyb namespace). */
  readonly iri: string;
  /** Scaled unit of the integer value. */
  readonly unit: "basis points";
  /** Digit budget (operand width of the matching filter circuit). */
  readonly digits: 4;
  /** Inclusive minimum, mirrored by sh:minInclusive in the shapes. */
  readonly minInclusive: number;
  /** Inclusive maximum, mirrored by sh:maxInclusive in the shapes. */
  readonly maxInclusive: number;
  /** sparq circuit that proves threshold statements over the field. */
  readonly circuit: "filter_int_d4";
}

export const ZK_FIELD_BUDGETS: readonly ZkFieldBudget[] = [
  {
    key: "ownershipPercentageBps",
    iri: KYB.ownershipPercentageBps,
    unit: "basis points",
    digits: 4,
    minInclusive: 0,
    maxInclusive: 10000,
    circuit: "filter_int_d4",
  },
] as const;

/**
 * ZK-anchorable fields that are NOT digit-budget threshold operands: Tier B's
 * owner-array commitment binds a hidden ARRAY (via a hash), not a single
 * bounded integer, so it has no `filter_int` digit budget — it is anchored
 * through the identical `kyb:ZkOperandAnchor` pattern for forgery-resistance
 * (design §4's decision-0012 posture applies uniformly to every hidden
 * operand, scalar or aggregate).
 */
export const ZK_COMMITMENT_FIELD_IRIS: readonly string[] = [
  KYB.beneficialOwnershipArrayCommitment,
] as const;

/**
 * IRIs a `kyb:ZkOperandAnchor` may anchor. Equals the sh:in list of
 * kybshape:ZkOperandAnchorSubjectShape's kyb:field constraint
 * (test-enforced).
 */
export const ZK_ANCHORABLE_FIELD_IRIS: readonly string[] = [
  ...ZK_FIELD_BUDGETS.map((budget) => budget.iri),
  ...ZK_COMMITMENT_FIELD_IRIS,
];

/** Budget for a field IRI, or undefined when the field is not ZK-provable. */
export function zkBudgetFor(fieldIri: string): ZkFieldBudget | undefined {
  return ZK_FIELD_BUDGETS.find((budget) => budget.iri === fieldIri);
}

/**
 * True when the integer fits the field's digit budget — use for seed/fixture
 * data before it reaches a circuit.
 */
export function fitsZkBudget(fieldIri: string, value: number): boolean {
  const budget = zkBudgetFor(fieldIri);
  if (!budget || !Number.isSafeInteger(value)) return false;
  return value >= budget.minInclusive && value <= budget.maxInclusive;
}
