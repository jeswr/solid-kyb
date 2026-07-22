/**
 * `@kyb/data-model` — vocabulary bindings, SHACL shapes and typed accessors
 * for the KYB (business-onboarding) walkthrough's pod resources
 * (docs/research/kyb-demo-design.md §3).
 *
 * House rules: all RDF through typed `@rdfjs/wrapper` accessors; Turtle out
 * only via the sanctioned serializer behind `resourceToTurtle()`
 * (SHACL-gated); only real dereferenceable namespaces (FIBO Business
 * Entities, OMG Commons, schema.org, W3C VC/DPV, SKOS) or the demo's own
 * published-URL `kyb:` vocabulary — never `urn:example:` or any other
 * minted placeholder.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export {
  buildIllustrativeLei,
  computeIso17442Checksum,
  ILLUSTRATIVE_LOU_PREFIX,
  isValidIso17442Checksum,
} from "./lei.ts";
export {
  type BeneficialOwnerValues,
  type Persona,
  PERSONA_VALUES,
  type PersonaFactoryOptions,
  type PersonaId,
  type PersonaIssuers,
  type PersonaResource,
  type PersonaResourceKind,
  type PersonaValues,
  personas,
  RESOURCE_POD_PATHS,
  ZK_OWNERSHIP_THRESHOLD_BPS,
} from "./personas.ts";
export {
  type KybResourceKind,
  RESOURCE_TARGET_CLASSES,
  type ShaclReport,
  type ShaclViolation,
  type ValidateOptions,
  validate,
} from "./shacl.ts";
export {
  ALL_SHAPES_DOCUMENTS,
  SHAPES_DOCUMENT_KEYS,
  SHAPES_TURTLE,
  type ShapesDocumentKey,
} from "./shapes/shapes.ts";
export { CMNS, CRED, DPV, FIBO, RDF_TYPE, SCHEMA, TURTLE_PREFIXES, XSD } from "./vocab/external.ts";
export {
  KYB,
  KYB_NAMESPACE,
  KYB_ONTOLOGY_IRI,
  type KybTermIri,
  type KybTermKey,
} from "./vocab/kyb.ts";
export {
  type AuthorizedOfficerInit,
  buildBeneficialOwnershipCredential,
  buildCddDecisionRecord,
  buildOfficerAuthorizationCredential,
  buildOrganisationalIdentityCredential,
  buildZkOperandAnchor,
  type BeneficialOwnershipCredentialInit,
  type CddDecisionRecordInit,
  type CredentialEnvelopeInit,
  type EntityOwnershipInit,
  type OfficerAuthorizationCredentialInit,
  type OrganisationalIdentityCredentialInit,
  type PostalAddressInit,
  type ZkOperandAnchorInit,
} from "./wrappers/build.ts";
export { literalFromXsdDate, literalFromXsdDecimal } from "./wrappers/mappings.ts";
export {
  AuthorizedOfficer,
  BeneficialOwnershipCredential,
  BeneficialOwnershipSubject,
  CDD_DECISION_STATUS_IRIS,
  CddDecisionRecord,
  CredentialResource,
  ENTITY_LEGAL_FORM_IRIS,
  EntityOwner,
  EntityOwnership,
  KybResource,
  OfficerAuthorizationCredential,
  OfficerAuthorizationSubject,
  OrganisationalIdentityCredential,
  OrganisationalIdentitySubject,
  ZkOperandAnchor,
  ZkOperandAnchorSubject,
} from "./wrappers/resources.ts";
export { resourceToTurtle, ShapeViolationError } from "./wrappers/serialize.ts";
export { LegalEntityIdentifier, PostalAddress, TypedNode } from "./wrappers/support.ts";
export {
  fitsZkBudget,
  ZK_ANCHORABLE_FIELD_IRIS,
  ZK_COMMITMENT_FIELD_IRIS,
  ZK_FIELD_BUDGETS,
  type ZkFieldBudget,
  zkBudgetFor,
} from "./zk-budgets.ts";

export const shapesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "shapes");
