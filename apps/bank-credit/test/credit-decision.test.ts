/**
 * Pure, deterministic coverage of the reuse-and-decide rule — no pod IO, no
 * clock. Verifies (a) the honest case (both credentials verify, eligible
 * legal form, owners disclosed) genuinely approves; (b) ANY evidence-gate
 * failure (unverified, subject-mismatched, or stale) genuinely declines,
 * never silently approves; (c) an ineligible legal form or an empty
 * ownership disclosure declines even once the evidence gate passes.
 */
import { describe, expect, it } from "vitest";
import type { CddEvidenceEntry } from "../lib/server/cdd-file";
import { runCreditDecision } from "../lib/server/credit-decision";

const LLC_IRI = "https://solid-kyb-vocab.vercel.app/kyb#EntityLegalForm-LLC";

function evidence(overrides: Partial<CddEvidenceEntry> = {}): CddEvidenceEntry {
  return {
    fresh: true,
    iri: "https://northwind.pod.example/kyb/credentials/org-identity",
    issuer: "https://issuers.example/orgs/org-identity-registrar#id",
    subjectBound: true,
    verified: true,
    verifyErrors: [],
    ...overrides,
  };
}

describe("the honest case genuinely approves", () => {
  it("approves when both credentials verify, the legal form is eligible, and owners are disclosed", () => {
    const decision = runCreditDecision({
      beneficialOwnership: evidence(),
      legalForm: LLC_IRI,
      orgIdentity: evidence(),
      ownerCount: 4,
    });
    expect(decision.outcome).toBe("approve");
    expect(decision.reasons).toHaveLength(0);
    expect(decision.findings.every((finding) => finding.pass)).toBe(true);
  });
});

describe("evidence-gate failures genuinely decline — never a silent approve", () => {
  it("an org-identity credential that fails verification declines", () => {
    const decision = runCreditDecision({
      beneficialOwnership: evidence(),
      legalForm: LLC_IRI,
      orgIdentity: evidence({ verified: false, verifyErrors: ["INVALID_SIGNATURE"] }),
      ownerCount: 4,
    });
    expect(decision.outcome).toBe("decline");
    expect(decision.reasons).toContain("organisational-identity credential could not be confirmed");
  });

  it("a revoked beneficial-ownership credential declines", () => {
    const decision = runCreditDecision({
      beneficialOwnership: evidence({ verified: false, verifyErrors: ["STATUS_REVOKED"] }),
      legalForm: LLC_IRI,
      orgIdentity: evidence(),
      ownerCount: 4,
    });
    expect(decision.outcome).toBe("decline");
    expect(decision.reasons).toContain("beneficial-ownership disclosure could not be confirmed");
  });

  it("an expired (stale) credential declines even though its signature is fine", () => {
    const decision = runCreditDecision({
      beneficialOwnership: evidence(),
      legalForm: LLC_IRI,
      orgIdentity: evidence({ fresh: false, verifyErrors: ["EXPIRED"] }),
      ownerCount: 4,
    });
    expect(decision.outcome).toBe("decline");
  });

  it("a subject-mismatched credential (attests a different business) declines", () => {
    const decision = runCreditDecision({
      beneficialOwnership: evidence(),
      legalForm: LLC_IRI,
      orgIdentity: evidence({ subjectBound: false }),
      ownerCount: 4,
    });
    expect(decision.outcome).toBe("decline");
  });

  it("both credentials failing reports both reasons", () => {
    const decision = runCreditDecision({
      beneficialOwnership: evidence({ verified: false }),
      legalForm: undefined,
      orgIdentity: evidence({ verified: false }),
      ownerCount: undefined,
    });
    expect(decision.outcome).toBe("decline");
    expect(decision.reasons).toEqual([
      "organisational-identity credential could not be confirmed",
      "beneficial-ownership disclosure could not be confirmed",
    ]);
  });
});

describe("eligibility rules apply only once the evidence gate passes", () => {
  it("an ineligible legal form declines with a specific reason", () => {
    const decision = runCreditDecision({
      beneficialOwnership: evidence(),
      legalForm: "https://solid-kyb-vocab.vercel.app/kyb#EntityLegalForm-SoleProprietor",
      orgIdentity: evidence(),
      ownerCount: 4,
    });
    expect(decision.outcome).toBe("decline");
    expect(decision.reasons).toContain("business legal form is not eligible for a line of credit");
  });

  it("zero disclosed owners declines with a specific reason", () => {
    const decision = runCreditDecision({
      beneficialOwnership: evidence(),
      legalForm: LLC_IRI,
      orgIdentity: evidence(),
      ownerCount: 0,
    });
    expect(decision.outcome).toBe("decline");
    expect(decision.reasons).toContain("no beneficial owners are disclosed on the credential");
  });
});
