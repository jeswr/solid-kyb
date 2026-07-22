/**
 * IRI constants for the vc-kit credential graphs. Every namespace is a real,
 * dereferenceable vocabulary (W3C cred/sec/status) or the demo's own
 * published-URL `kyb:` vocabulary (`@kyb/data-model`) - never a minted
 * placeholder (house rule).
 */

import { RESOURCE_TARGET_CLASSES, type KybResourceKind } from "@kyb/data-model";

export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** W3C Verifiable Credentials 2.0 vocabulary. */
export const CRED = "https://www.w3.org/2018/credentials#";
export const VC_CREDENTIAL = `${CRED}VerifiableCredential`;
export const VC_ISSUER = `${CRED}issuer`;
export const VC_VALID_FROM = `${CRED}validFrom`;
export const VC_VALID_UNTIL = `${CRED}validUntil`;
export const VC_CREDENTIAL_SUBJECT = `${CRED}credentialSubject`;
export const VC_CREDENTIAL_STATUS = `${CRED}credentialStatus`;
export const VC_CREDENTIAL_SCHEMA = `${CRED}credentialSchema`;

/** W3C Data Integrity / security vocabulary (proof nodes). */
export const SEC = "https://w3id.org/security#";
export const SEC_PROOF = `${SEC}proof`;
export const SEC_DATA_INTEGRITY_PROOF = `${SEC}DataIntegrityProof`;
export const SEC_CRYPTOSUITE = `${SEC}cryptosuite`;
export const SEC_VERIFICATION_METHOD = `${SEC}verificationMethod`;
export const SEC_PROOF_PURPOSE = `${SEC}proofPurpose`;
export const SEC_PROOF_VALUE = `${SEC}proofValue`;
export const SEC_ASSERTION_METHOD = `${SEC}assertionMethod`;

/** Data Integrity proof `created` timestamps use dcterms:created. */
export const DC_CREATED = "http://purl.org/dc/terms/created";

/** W3C Bitstring Status List vocabulary. */
export const STATUS = "https://www.w3.org/ns/credentials/status#";
export const STATUS_BITSTRING_ENTRY = `${STATUS}BitstringStatusListEntry`;
export const STATUS_PURPOSE = `${STATUS}statusPurpose`;
export const STATUS_LIST_INDEX = `${STATUS}statusListIndex`;
export const STATUS_LIST_CREDENTIAL = `${STATUS}statusListCredential`;

/** XSD datatypes. */
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const XSD_DATE = `${XSD}date`;
export const XSD_DATE_TIME = `${XSD}dateTime`;

/**
 * The demo's SHACL shape identities (credentialSchema targets) - the SAME
 * real, published-URL `kyb` vocab project's shapes namespace already used by
 * `packages/data-model/shapes/*.ttl` (`kybshape:`), never a minted
 * `urn:example:` placeholder (the lending demo's documented mistake).
 */
export const LSHAPE = "https://solid-kyb-vocab.vercel.app/kyb/shapes#";

const SHAPE_LOCAL_NAMES = {
  "org-identity-credential": "OrganisationalIdentityCredentialShape",
  "beneficial-ownership-credential": "BeneficialOwnershipCredentialShape",
  "officer-authorization-credential": "OfficerAuthorizationCredentialShape",
  "zk-operand-anchor": "ZkOperandAnchorShape",
} as const;

/** The data-model resource kinds that are Verifiable Credentials (issuable here). */
export type CredentialKind = keyof typeof SHAPE_LOCAL_NAMES;

/** `cred:credentialSchema` IRI per credential kind. */
export function credentialSchemaIri(kind: CredentialKind): string {
  return `${LSHAPE}${SHAPE_LOCAL_NAMES[kind]}`;
}

/** The `sh:targetClass` (kyb class) of a credential kind. */
export function targetClassOf(kind: CredentialKind): string {
  return RESOURCE_TARGET_CLASSES[kind];
}

/** Narrow a data-model resource kind to a credential kind, or `undefined`. */
export function asCredentialKind(kind: KybResourceKind): CredentialKind | undefined {
  return kind in SHAPE_LOCAL_NAMES ? (kind as CredentialKind) : undefined;
}

/** The credential kind whose target class appears in `types`, or `undefined`. */
export function credentialKindOfTypes(types: readonly string[]): CredentialKind | undefined {
  const kinds = Object.keys(SHAPE_LOCAL_NAMES) as readonly CredentialKind[];
  return kinds.find((kind) => types.includes(RESOURCE_TARGET_CLASSES[kind]));
}
