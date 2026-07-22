/**
 * `@kyb/vc-kit` — VC issue/verify/status/re-issue for the KYB business-
 * onboarding walkthrough (design §3/§5), built on the pinned `@jeswr/solid-vc`
 * primitive, PLUS the beneficial-ownership ZK prover (design §4): a Tier A
 * live per-owner threshold proof and a Tier B live completeness-scan proof
 * over "no undisclosed beneficial owner holds >= 25%".
 *
 * SECURITY-CRITICAL surface: every verification gate is fail-closed (an
 * unreachable status list, a malformed proof node, a shape violation or an
 * unresolvable key is a FAILURE, never a pass), and nothing here ever reads
 * the wall clock — `now` / validity windows are explicit parameters.
 */

// Key handling + shared types re-exported from the pinned @jeswr/solid-vc so
// consumers need only this package.
export {
  type BitstringStatusListEntry,
  type BitstringStatusListEntryInput,
  type CredentialStatusCheck,
  createWebIdKeyResolver,
  cryptosuiteForKeyType,
  type DataIntegrityProof,
  exportPrivateJwk,
  exportPublicJwk,
  generateKeyPairForSuite,
  importKeyPair,
  importPublicKey,
  type KeyPair,
  type PublishVerificationMethodInput,
  publishVerificationMethod,
  resolveWebIdKey,
  type SuiteKeyType,
  type WebIdKeyResolver,
} from "@jeswr/solid-vc";

export {
  assertAbsoluteIri,
  type BeneficialOwnershipClaims,
  buildKybCredentialResource,
  ClaimInputError,
  type CredentialEnvelope,
  type KybCredentialClaims,
  type OfficerAuthorizationClaims,
  type OrganisationalIdentityClaims,
  type ZkOperandAnchorClaims,
} from "./claims.ts";
export { documentQuadsOf, ProofReadError, purposeIri, readProof } from "./credential.ts";
export {
  type FinishIssueOptions,
  finishIssue,
  type IssueCredentialOptions,
  type IssuedCredential,
  IssueRefusedError,
  issueCredential,
  type ValidityWindow,
  writeValidityAndStatus,
} from "./issue.ts";
export {
  isFresh,
  ReissueError,
  type ReissueOptions,
  type ReissueResult,
  reissueCredential,
  type ValidityWindowInfo,
} from "./reissue.ts";
export {
  type DeriveStatusIndexOptions,
  deriveStatusIndex,
  MIN_STATUS_LIST_LENGTH,
  StatusIndexAllocator,
  StatusListClient,
  type StatusListClientOptions,
  StatusListError,
  type StatusListWriteOptions,
} from "./status.ts";
export {
  type CheckCredentialStatusOptions,
  checkCredentialStatus,
  type EmbeddedProofOptions,
  type VcKitErrorCode,
  type VcKitVerificationError,
  type VerifiedCredentialInfo,
  type VerifyCredentialOptions,
  type VerifyCredentialResult,
  verifyCredential,
  verifyEmbeddedProofs,
} from "./verify.ts";
export {
  asCredentialKind,
  type CredentialKind,
  credentialKindOfTypes,
  credentialSchemaIri,
  LSHAPE,
  targetClassOf,
} from "./vocab.ts";
export * from "./zk/index.ts";
