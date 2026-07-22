/**
 * The Business Credit Desk's deterministic credit decision (design §5 scenes
 * 3-4): a business line of credit, decided over the SAME org-identity +
 * beneficial-ownership credentials the business already holds — reused, not
 * re-collected. Pure function over pre-verified evidence: no randomness, no
 * clock, no pod IO — every time-dependent signal (credential freshness)
 * arrives as an explicit pre-computed input, so the same file always
 * produces a byte-identical decision.
 *
 * Binary outcome by design (unlike the lending showcase's bureau-only rail,
 * which downgrades unverifiable evidence to "refer"): this desk's whole
 * product IS the reuse of an already-verified identity/ownership record, so
 * a credential that fails ANY fail-closed gate (signature, issuer trust,
 * validity window, Bitstring status, subject binding, SHACL shape) declines
 * the line outright, with the specific gate failures reported as reasons —
 * never approved, never silently downgraded.
 */
import type { CddEvidenceEntry } from "./cdd-file";

export type CreditDecisionOutcome = "approve" | "decline";

export interface CreditDecisionFinding {
  readonly code: string;
  readonly rule: string;
  readonly pass: boolean;
  readonly observed: string;
}

export interface CreditDecision {
  readonly outcome: CreditDecisionOutcome;
  readonly findings: readonly CreditDecisionFinding[];
  /** Business-facing decline reasons — empty on approve. */
  readonly reasons: readonly string[];
}

const ALLOWED_LEGAL_FORMS = new Set([
  "https://solid-kyb-vocab.vercel.app/kyb#EntityLegalForm-LLC",
  "https://solid-kyb-vocab.vercel.app/kyb#EntityLegalForm-Corp",
  "https://solid-kyb-vocab.vercel.app/kyb#EntityLegalForm-LLP",
]);

function evidenceFinding(
  code: string,
  label: string,
  entry: CddEvidenceEntry,
): CreditDecisionFinding {
  const failures: string[] = [];
  if (!entry.verified) failures.push("failed fail-closed verification");
  if (!entry.subjectBound) failures.push("attests a different subject");
  if (!entry.fresh) failures.push("validity window lapsed");
  const pass = failures.length === 0;
  return {
    code,
    observed: pass
      ? `${label} verified, subject-bound, and within its validity window`
      : `${label}: ${failures.join("; ")}`,
    pass,
    rule: `The ${label.toLowerCase()} credential must fully verify, attest the business, and be within its validity window`,
  };
}

export interface CreditDecisionInput {
  readonly orgIdentity: CddEvidenceEntry;
  readonly beneficialOwnership: CddEvidenceEntry;
  /** Present only when BOTH credentials verified — see `readCddFile`. */
  readonly legalForm: string | undefined;
  readonly ownerCount: number | undefined;
}

/**
 * Run the reuse-and-decide rule. Evidence problems are evaluated FIRST and
 * decline the line outright — a credential this desk cannot trust is never
 * the basis for extending credit, exactly as an unverifiable file would be
 * refused in production.
 */
export function runCreditDecision(input: CreditDecisionInput): CreditDecision {
  const findings: CreditDecisionFinding[] = [
    evidenceFinding("EVIDENCE_ORG_IDENTITY", "Organisational-identity", input.orgIdentity),
    evidenceFinding(
      "EVIDENCE_BENEFICIAL_OWNERSHIP",
      "Beneficial-ownership",
      input.beneficialOwnership,
    ),
  ];

  const reasons: string[] = [];
  if (!findings[0]?.pass) {
    reasons.push("organisational-identity credential could not be confirmed");
  }
  if (!findings[1]?.pass) {
    reasons.push("beneficial-ownership disclosure could not be confirmed");
  }

  if (reasons.length > 0) {
    return { findings, outcome: "decline", reasons };
  }

  // The evidence gate passed: both credentials verify, are subject-bound,
  // and are fresh. Apply the desk's own eligibility rules over the now-
  // trustworthy disclosed claims.
  const legalFormOk = input.legalForm !== undefined && ALLOWED_LEGAL_FORMS.has(input.legalForm);
  findings.push({
    code: "ELIGIBLE_LEGAL_FORM",
    observed: input.legalForm ?? "unknown",
    pass: legalFormOk,
    rule: "The business's disclosed legal form must be an entity type this desk extends credit to (LLC, Corp, or LLP)",
  });
  if (!legalFormOk) reasons.push("business legal form is not eligible for a line of credit");

  const ownershipDisclosedOk = (input.ownerCount ?? 0) > 0;
  findings.push({
    code: "OWNERSHIP_DISCLOSED",
    observed: `${input.ownerCount ?? 0} disclosed owner(s)`,
    pass: ownershipDisclosedOk,
    rule: "At least one beneficial owner must be disclosed on the credential",
  });
  if (!ownershipDisclosedOk) reasons.push("no beneficial owners are disclosed on the credential");

  const outcome: CreditDecisionOutcome = reasons.length === 0 ? "approve" : "decline";
  return { findings, outcome, reasons };
}
