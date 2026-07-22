// Generated from vocab/kyb.ttl by scripts/generate-vocab.mjs - DO NOT EDIT.
// Regenerate from packages/data-model: node scripts/generate-vocab.mjs

/** Identity of the kyb residue vocabulary (a real, published-URL namespace — see vocab/kyb.ttl). */
export const KYB_ONTOLOGY_IRI = "https://solid-kyb-vocab.vercel.app/kyb";

/** Namespace of the kyb residue vocabulary. */
export const KYB_NAMESPACE = "https://solid-kyb-vocab.vercel.app/kyb#";

/**
 * IRI constants for every term defined in vocab/kyb.ttl
 * (hyphens in SKOS concept local names become underscores).
 */
export const KYB = {
  AuthorizedOfficer: "https://solid-kyb-vocab.vercel.app/kyb#AuthorizedOfficer",
  beneficialOwnershipArrayCommitment:
    "https://solid-kyb-vocab.vercel.app/kyb#beneficialOwnershipArrayCommitment",
  BeneficialOwnershipCredential:
    "https://solid-kyb-vocab.vercel.app/kyb#BeneficialOwnershipCredential",
  BeneficialOwnershipVerificationPurpose:
    "https://solid-kyb-vocab.vercel.app/kyb#BeneficialOwnershipVerificationPurpose",
  cddCheckDate: "https://solid-kyb-vocab.vercel.app/kyb#cddCheckDate",
  CddDecisionRecord: "https://solid-kyb-vocab.vercel.app/kyb#CddDecisionRecord",
  cddDecisionStatus: "https://solid-kyb-vocab.vercel.app/kyb#cddDecisionStatus",
  CddDecisionStatus_Declined: "https://solid-kyb-vocab.vercel.app/kyb#CddDecisionStatus-Declined",
  CddDecisionStatus_Opened: "https://solid-kyb-vocab.vercel.app/kyb#CddDecisionStatus-Opened",
  CddDecisionStatus_PendingReview:
    "https://solid-kyb-vocab.vercel.app/kyb#CddDecisionStatus-PendingReview",
  CddDecisionStatusScheme: "https://solid-kyb-vocab.vercel.app/kyb#CddDecisionStatusScheme",
  checkedCredential: "https://solid-kyb-vocab.vercel.app/kyb#checkedCredential",
  EntityLegalForm_Corp: "https://solid-kyb-vocab.vercel.app/kyb#EntityLegalForm-Corp",
  EntityLegalForm_LLC: "https://solid-kyb-vocab.vercel.app/kyb#EntityLegalForm-LLC",
  EntityLegalForm_LLP: "https://solid-kyb-vocab.vercel.app/kyb#EntityLegalForm-LLP",
  EntityLegalFormScheme: "https://solid-kyb-vocab.vercel.app/kyb#EntityLegalFormScheme",
  field: "https://solid-kyb-vocab.vercel.app/kyb#field",
  hasAuthorizedOfficer: "https://solid-kyb-vocab.vercel.app/kyb#hasAuthorizedOfficer",
  hasOwnershipRecord: "https://solid-kyb-vocab.vercel.app/kyb#hasOwnershipRecord",
  isIllustrativeLei: "https://solid-kyb-vocab.vercel.app/kyb#isIllustrativeLei",
  OfficerAuthorizationCredential:
    "https://solid-kyb-vocab.vercel.app/kyb#OfficerAuthorizationCredential",
  operandEnc: "https://solid-kyb-vocab.vercel.app/kyb#operandEnc",
  OrganisationalIdentityCredential:
    "https://solid-kyb-vocab.vercel.app/kyb#OrganisationalIdentityCredential",
  ownershipPercentageBps: "https://solid-kyb-vocab.vercel.app/kyb#ownershipPercentageBps",
  ZkOperandAnchor: "https://solid-kyb-vocab.vercel.app/kyb#ZkOperandAnchor",
} as const;

/** Constant keys of the kyb vocabulary. */
export type KybTermKey = keyof typeof KYB;

/** Term IRIs of the kyb vocabulary. */
export type KybTermIri = (typeof KYB)[KybTermKey];
