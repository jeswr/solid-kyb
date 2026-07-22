import type { Term } from "@rdfjs/types";
import { type ITermWrapperConstructor, RequiredAs, TermFrom } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { CMNS, CRED, FIBO, SCHEMA } from "../vocab/external.ts";
import { KYB } from "../vocab/kyb.ts";
import {
  AuthorizedOfficer,
  BeneficialOwnershipCredential,
  CddDecisionRecord,
  type CredentialResource,
  EntityOwner,
  EntityOwnership,
  OfficerAuthorizationCredential,
  OrganisationalIdentityCredential,
  ZkOperandAnchor,
} from "./resources.ts";
import { LegalEntityIdentifier, PostalAddress, type TypedNode } from "./support.ts";

/**
 * Build functions: plain init objects in, shape-conforming wrapper instances
 * out. Every triple is created through the `@rdfjs/wrapper` accessors (house
 * rule — no hand-built quads, no string Turtle), into a fresh `n3.Store` with
 * one shared `DataFactory`.
 *
 * Determinism: blank nodes carry explicit, per-document-unique labels and
 * every builder adds triples in a fixed order, so identical inits serialise
 * to byte-identical Turtle (the persona fixtures rely on this).
 */

function newDocument(rootIri: string): { store: Store; root: Term } {
  const store = new Store();
  return { store, root: DataFactory.namedNode(rootIri) };
}

/** Link `parent --predicate--> node` through the wrapper layer. */
function link(parent: TypedNode, predicate: string, node: Term): void {
  RequiredAs.object(parent, predicate, node, TermFrom.itself);
}

function blank(label: string): Term {
  return DataFactory.blankNode(label);
}

function wrap<T>(ctor: ITermWrapperConstructor<T>, term: Term, anchor: TypedNode): T {
  return new ctor(term, anchor.dataset, anchor.factory);
}

export interface PostalAddressInit {
  streetAddress: string;
  addressLocality: string;
  /** Two-letter US state code. */
  addressRegion: string;
  /** US ZIP or ZIP+4. */
  postalCode: string;
}

function addPostalAddress(
  parent: TypedNode,
  predicate: string,
  init: PostalAddressInit,
  label: string,
): void {
  const node = blank(label);
  link(parent, predicate, node);
  const address = wrap(PostalAddress, node, parent);
  address.typeIris.add(SCHEMA.PostalAddress);
  address.streetAddress = init.streetAddress;
  address.addressLocality = init.addressLocality;
  address.addressRegion = init.addressRegion;
  address.postalCode = init.postalCode;
}

/** The W3C VC 2.0 envelope shared by the credential builders. */
export interface CredentialEnvelopeInit {
  /** The credential's own pod resource IRI. */
  iri: string;
  /** Issuer identity IRI. */
  issuer: string;
  validFrom: Date;
  validUntil?: Date;
  /** Status-list entry IRI. */
  credentialStatus: string;
  /** The business's own WebID (holder binding). */
  credentialSubject: string;
}

function applyEnvelope(
  credential: CredentialResource,
  init: CredentialEnvelopeInit,
  kybType: string,
): void {
  credential.typeIris.add(CRED.VerifiableCredential);
  credential.typeIris.add(kybType);
  credential.issuer = init.issuer;
  credential.validFrom = init.validFrom;
  if (init.validUntil !== undefined) credential.validUntil = init.validUntil;
  credential.credentialStatusIri = init.credentialStatus;
  credential.credentialSubjectIri = init.credentialSubject;
}

export interface OrganisationalIdentityCredentialInit extends CredentialEnvelopeInit {
  businessName: string;
  address: PostalAddressInit;
  /** ISO 17442 lexical form (18 alphanumeric + 2-digit checksum) — always illustrative. */
  lei: string;
  /** One of {@link ENTITY_LEGAL_FORM_IRIS}. */
  legalForm: string;
}

export function buildOrganisationalIdentityCredential(
  init: OrganisationalIdentityCredentialInit,
): OrganisationalIdentityCredential {
  const { store, root } = newDocument(init.iri);
  const credential = new OrganisationalIdentityCredential(root, store, DataFactory);
  applyEnvelope(credential, init, KYB.OrganisationalIdentityCredential);
  const subject = credential.credentialSubject;
  subject.typeIris.add(FIBO.LEIRegisteredEntity);
  subject.typeIris.add(FIBO.BusinessEntity);
  subject.typeIris.add(SCHEMA.Organization);
  subject.businessName = init.businessName;
  addPostalAddress(subject, SCHEMA.address, init.address, "businessAddress");
  const leiNode = blank("lei");
  link(subject, CMNS.isIdentifiedBy, leiNode);
  const lei = wrap(LegalEntityIdentifier, leiNode, subject);
  lei.typeIris.add(FIBO.LegalEntityIdentifier);
  lei.lei = init.lei;
  subject.legalForm = init.legalForm;
  return credential;
}

export interface EntityOwnershipInit {
  ownerName: string;
  /** Disclosed display percentage (0..100). */
  ownershipPercentage: number;
  /** ZK field inside the 4-digit budget (0..10000 basis points). */
  ownershipPercentageBps: number;
}

export interface BeneficialOwnershipCredentialInit extends CredentialEnvelopeInit {
  /** The owned business's own WebID (equal to `credentialSubject` in this demo). */
  ownedEntity: string;
  ownershipRecords: readonly EntityOwnershipInit[];
}

export function buildBeneficialOwnershipCredential(
  init: BeneficialOwnershipCredentialInit,
): BeneficialOwnershipCredential {
  const { store, root } = newDocument(init.iri);
  const credential = new BeneficialOwnershipCredential(root, store, DataFactory);
  applyEnvelope(credential, init, KYB.BeneficialOwnershipCredential);
  const subject = credential.credentialSubject;
  const records = subject.ownershipRecords;
  init.ownershipRecords.forEach((recordInit, index) => {
    // Multi-valued: add through the live set (a single-object setter would
    // REPLACE the previous record).
    const recordNode = blank(`ownershipRecord${index}`);
    const record = wrap(EntityOwnership, recordNode, subject);
    record.typeIris.add(FIBO.EntityOwnership);
    const ownerNode = blank(`owner${index}`);
    link(record, FIBO.hasOwningEntity, ownerNode);
    const owner = wrap(EntityOwner, ownerNode, record);
    owner.typeIris.add(FIBO.EntityOwner);
    owner.typeIris.add(CMNS.LegalPerson);
    owner.typeIris.add(SCHEMA.Person);
    owner.ownerName = recordInit.ownerName;
    record.ownedEntityIri = init.ownedEntity;
    record.ownershipPercentage = recordInit.ownershipPercentage;
    record.ownershipPercentageBps = recordInit.ownershipPercentageBps;
    records.add(record);
  });
  return credential;
}

export interface AuthorizedOfficerInit {
  officerName: string;
  jobTitle: string;
}

export interface OfficerAuthorizationCredentialInit extends CredentialEnvelopeInit {
  /** The business's own WebID (equal to `credentialSubject` in this demo). */
  business: string;
  officer: AuthorizedOfficerInit;
}

export function buildOfficerAuthorizationCredential(
  init: OfficerAuthorizationCredentialInit,
): OfficerAuthorizationCredential {
  const { store, root } = newDocument(init.iri);
  const credential = new OfficerAuthorizationCredential(root, store, DataFactory);
  applyEnvelope(credential, init, KYB.OfficerAuthorizationCredential);
  const subject = credential.credentialSubject;
  const officerNode = blank("officer");
  link(subject, KYB.hasAuthorizedOfficer, officerNode);
  const officer = wrap(AuthorizedOfficer, officerNode, subject);
  officer.typeIris.add(FIBO.Signatory);
  officer.typeIris.add(FIBO.CorporateOfficer);
  officer.typeIris.add(SCHEMA.Person);
  officer.officerName = init.officer.officerName;
  officer.jobTitle = init.officer.jobTitle;
  officer.hasSigningAuthorityForIri = init.business;
  officer.isOfficerOfIri = init.business;
  return credential;
}

export interface CddDecisionRecordInit {
  iri: string;
  /** One of `CDD_DECISION_STATUS_IRIS`. */
  decisionStatus: string;
  checkDate: Date;
  /** The credential pod-resource IRIs checked (>= 1). */
  checkedCredentials: readonly string[];
}

/** Build one SHACL-validated bank-written CDD decision record. */
export function buildCddDecisionRecord(init: CddDecisionRecordInit): CddDecisionRecord {
  const { store, root } = newDocument(init.iri);
  const record = new CddDecisionRecord(root, store, DataFactory);
  record.typeIris.add(KYB.CddDecisionRecord);
  record.decisionStatus = init.decisionStatus;
  record.checkDate = init.checkDate;
  const checked = record.checkedCredentialIris;
  for (const iri of init.checkedCredentials) checked.add(iri);
  return record;
}

export interface ZkOperandAnchorInit extends CredentialEnvelopeInit {
  /** Must be `KYB.ownershipPercentageBps` in this demo. */
  field: string;
  /** Deterministic sparq operand encoding (0x-prefixed lowercase hex). */
  operandEnc: string;
}

export function buildZkOperandAnchor(init: ZkOperandAnchorInit): ZkOperandAnchor {
  const { store, root } = newDocument(init.iri);
  const anchor = new ZkOperandAnchor(root, store, DataFactory);
  applyEnvelope(anchor, init, KYB.ZkOperandAnchor);
  const subject = anchor.credentialSubject;
  subject.fieldIri = init.field;
  subject.operandEnc = init.operandEnc;
  return anchor;
}
