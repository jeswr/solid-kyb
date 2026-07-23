/**
 * IRI constants for the real, dereferenceable external vocabularies the KYB
 * resources use (design §3.2-§3.4; house rule: no minted IRIs — project
 * residue terms live in ./kyb.ts, generated from vocab/kyb.ttl).
 *
 * Only terms the typed wrappers actually read or write are bound here; the
 * SHACL shapes in shapes/*.ttl remain the authority on each term's role.
 */

export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

const XSD_NS = "http://www.w3.org/2001/XMLSchema#";

/** XSD datatypes needed by the custom literal mappings in wrappers/mappings.ts. */
export const XSD = {
  date: `${XSD_NS}date`,
  decimal: `${XSD_NS}decimal`,
  boolean: `${XSD_NS}boolean`,
} as const;

const SCHEMA_NS = "https://schema.org/";

/**
 * schema.org terms — person/address/org display fields only. Note there is
 * deliberately no `schema:identifier` here: the LEI is an identifier
 * INDIVIDUAL (`fibo-be-le-lei:LegalEntityIdentifier`) whose literal value is
 * carried by the OMG Commons text predicate `cmns-txt:hasTextValue`
 * (`CMNS.hasTextValue`), not a schema.org string annotation — the
 * FIBO/Commons "identifiers are individuals, referenced by
 * cmns-id:isIdentifiedBy" pattern.
 */
export const SCHEMA = {
  Organization: `${SCHEMA_NS}Organization`,
  Person: `${SCHEMA_NS}Person`,
  PostalAddress: `${SCHEMA_NS}PostalAddress`,
  address: `${SCHEMA_NS}address`,
  addressLocality: `${SCHEMA_NS}addressLocality`,
  addressRegion: `${SCHEMA_NS}addressRegion`,
  jobTitle: `${SCHEMA_NS}jobTitle`,
  name: `${SCHEMA_NS}name`,
  postalCode: `${SCHEMA_NS}postalCode`,
  streetAddress: `${SCHEMA_NS}streetAddress`,
} as const;

const CRED_NS = "https://www.w3.org/2018/credentials#";

/** W3C VC 2.0 terms (the org-identity, beneficial-ownership, officer-authorization and ZK-anchor credentials). */
export const CRED = {
  VerifiableCredential: `${CRED_NS}VerifiableCredential`,
  credentialSchema: `${CRED_NS}credentialSchema`,
  credentialStatus: `${CRED_NS}credentialStatus`,
  credentialSubject: `${CRED_NS}credentialSubject`,
  issuer: `${CRED_NS}issuer`,
  validFrom: `${CRED_NS}validFrom`,
  validUntil: `${CRED_NS}validUntil`,
} as const;

const DPV_NS = "https://w3id.org/dpv#";

/** DPV purpose term (design §3.5's consent-purpose residue — future consent ledger). */
export const DPV = {
  Purpose: `${DPV_NS}Purpose`,
} as const;

const FIBO_NS = "https://spec.edmcouncil.org/fibo/ontology/BE/";
const BE_LEI = `${FIBO_NS}LegalEntities/LEIEntities/`;
const BE_LP = `${FIBO_NS}LegalEntities/LegalPersons/`;
const BE_OWNERSHIP = `${FIBO_NS}OwnershipAndControl/OwnershipParties/`;
const BE_EXEC = `${FIBO_NS}OwnershipAndControl/Executives/`;
const CMNS_ORG_NS = "https://www.omg.org/spec/Commons/Organizations/";
const CMNS_ID_NS = "https://www.omg.org/spec/Commons/Identifiers/";
const CMNS_TXT_NS = "https://www.omg.org/spec/Commons/TextDatatype/";

/**
 * FIBO Business Entities classes and properties (design §3.1/§3.4). Every
 * term was fetched and confirmed to exist in the `Release`-maturity BE
 * modules (2026-07-22, `Accept: text/turtle`, final status 200 in every
 * case) — see docs/fibo-be-gleif-binding.md for the full binding table.
 */
export const FIBO = {
  // BE/LegalEntities/LEIEntities
  LEIRegisteredEntity: `${BE_LEI}LEIRegisteredEntity`,
  LegalEntityIdentifier: `${BE_LEI}LegalEntityIdentifier`,
  hasLegalForm: `${BE_LEI}hasLegalForm`,
  hasOwnershipPercentage: `${BE_LEI}hasOwnershipPercentage`,
  // BE/LegalEntities/LegalPersons
  BusinessEntity: `${BE_LP}BusinessEntity`,
  // BE/OwnershipAndControl/OwnershipParties
  EntityOwner: `${BE_OWNERSHIP}EntityOwner`,
  EntityOwnership: `${BE_OWNERSHIP}EntityOwnership`,
  hasOwnedEntity: `${BE_OWNERSHIP}hasOwnedEntity`,
  hasOwningEntity: `${BE_OWNERSHIP}hasOwningEntity`,
  // hasDirectOwnership: business -> its EntityOwnership situations. FIBO's
  // own owl:inverseOf hasOwnedEntity (domain BusinessEntity/LegalEntity,
  // range EntityOwnership) — the DIRECT term that replaces the previously
  // minted kyb:hasOwnershipRecord.
  hasDirectOwnership: `${BE_OWNERSHIP}hasDirectOwnership`,
  // BE/OwnershipAndControl/Executives
  CorporateOfficer: `${BE_EXEC}CorporateOfficer`,
  Signatory: `${BE_EXEC}Signatory`,
  // hasCorporateOfficer: business (ControlledParty) -> CorporateOfficer.
  // FIBO's own owl:inverseOf isOfficerOf — the DIRECT term that replaces the
  // previously minted kyb:hasAuthorizedOfficer.
  hasCorporateOfficer: `${BE_EXEC}hasCorporateOfficer`,
  hasSigningAuthorityFor: `${BE_EXEC}hasSigningAuthorityFor`,
  isOfficerOf: `${BE_EXEC}isOfficerOf`,
} as const;

/** OMG Commons — Organizations, Identifiers and TextDatatype (imported by FIBO-BE, re-opened there). */
export const CMNS = {
  LegalPerson: `${CMNS_ORG_NS}LegalPerson`,
  isIdentifiedBy: `${CMNS_ID_NS}isIdentifiedBy`,
  // The literal value of an identifier individual (cmns-dsg:hasTag and the
  // FIBO LEI-code carriers are sub-properties of this). The LEI string hangs
  // off the LegalEntityIdentifier node here, NOT as a schema:identifier.
  hasTextValue: `${CMNS_TXT_NS}hasTextValue`,
} as const;

/** Prefix map for Turtle serialisation of the KYB resources. */
export const TURTLE_PREFIXES: Readonly<Record<string, string>> = {
  cred: CRED_NS,
  "cmns-id": CMNS_ID_NS,
  "cmns-org": CMNS_ORG_NS,
  "cmns-txt": CMNS_TXT_NS,
  dpv: DPV_NS,
  "fibo-be-le-lei": BE_LEI,
  "fibo-be-le-lp": BE_LP,
  "fibo-be-oac-exec": BE_EXEC,
  "fibo-be-oac-opty": BE_OWNERSHIP,
  kyb: "https://solid-kyb-vocab.vercel.app/kyb#",
  schema: SCHEMA_NS,
  xsd: XSD_NS,
};
