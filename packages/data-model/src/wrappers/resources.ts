import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  RequiredAs,
  RequiredFrom,
  SetFrom,
  TermAs,
} from "@rdfjs/wrapper";
import type { KybResourceKind } from "../shacl.ts";
import { CMNS, CRED, FIBO, SCHEMA } from "../vocab/external.ts";
import { KYB } from "../vocab/kyb.ts";
import { ZK_ANCHORABLE_FIELD_IRIS, fitsZkBudget } from "../zk-budgets.ts";
import { literalFromXsdDate, literalFromXsdDecimal } from "./mappings.ts";
import { LegalEntityIdentifier, PostalAddress, TypedNode } from "./support.ts";

/**
 * Typed accessors over the three §3.2 KYB credentials plus the CDD decision
 * record and the ZK operand anchor (shapes/*.ttl). Reading AND building go
 * through these wrappers — app code never walks datasets or concatenates
 * Turtle. Setters enforce the cheap invariants early (ZK digit budget,
 * controlled-vocabulary membership, masked/illustrative identifiers);
 * `resourceToTurtle()` then validates the full document against the matching
 * SHACL shape before any bytes leave the process.
 */
export abstract class KybResource extends TypedNode {
  /** The shapes/validate() kind this wrapper's document must conform to. */
  abstract get resourceKind(): KybResourceKind;
}

function assertMember(label: string, value: string, allowed: readonly string[]): void {
  if (!allowed.includes(value)) {
    throw new RangeError(`${label} must be one of ${allowed.join(", ")}; got ${value}`);
  }
}

/** Value space of `fibo-be-le-lei:hasLegalForm` (design's illustrative ELF scheme). */
export const ENTITY_LEGAL_FORM_IRIS = [
  KYB.EntityLegalForm_LLC,
  KYB.EntityLegalForm_Corp,
  KYB.EntityLegalForm_LLP,
] as const;

/** Value space of `kyb:cddDecisionStatus`. */
export const CDD_DECISION_STATUS_IRIS = [
  KYB.CddDecisionStatus_Opened,
  KYB.CddDecisionStatus_Declined,
  KYB.CddDecisionStatus_PendingReview,
] as const;

/**
 * Shared accessors of the credential resources (W3C VC 2.0 envelope).
 * `validUntil` is optional at this level because the ZK anchor revokes
 * rather than expires; the per-kind shape enforces requiredness at
 * serialize.
 */
export abstract class CredentialResource extends KybResource {
  get issuer(): string {
    return RequiredFrom.subjectPredicate(this, CRED.issuer, NamedNodeAs.string);
  }
  set issuer(value: string) {
    RequiredAs.object(this, CRED.issuer, value, NamedNodeFrom.string);
  }

  get validFrom(): Date {
    return RequiredFrom.subjectPredicate(this, CRED.validFrom, LiteralAs.date);
  }
  set validFrom(value: Date) {
    RequiredAs.object(this, CRED.validFrom, value, LiteralFrom.dateTime);
  }

  get validUntil(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, CRED.validUntil, LiteralAs.date);
  }
  set validUntil(value: Date | undefined) {
    OptionalAs.object(this, CRED.validUntil, value, LiteralFrom.dateTime);
  }

  /** The status-list entry IRI (Bitstring Status List per issuer app). */
  get credentialStatusIri(): string {
    return RequiredFrom.subjectPredicate(this, CRED.credentialStatus, NamedNodeAs.string);
  }
  set credentialStatusIri(value: string) {
    RequiredAs.object(this, CRED.credentialStatus, value, NamedNodeFrom.string);
  }

  /** The business's own WebID (holder binding — house rule). */
  get credentialSubjectIri(): string {
    return RequiredFrom.subjectPredicate(this, CRED.credentialSubject, NamedNodeAs.string);
  }
  set credentialSubjectIri(value: string) {
    RequiredAs.object(this, CRED.credentialSubject, value, NamedNodeFrom.string);
  }

  /** `cred:credentialSchema` IRIs (unbounded; live write-through set). */
  get credentialSchemaIris(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      CRED.credentialSchema,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}

/**
 * Claims node of the organisational-identity VC — the business's own WebID
 * (kybshape:OrganisationalIdentitySubjectShape).
 */
export class OrganisationalIdentitySubject extends TypedNode {
  get businessName(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.name, LiteralAs.string);
  }
  set businessName(value: string) {
    RequiredAs.object(this, SCHEMA.name, value, LiteralFrom.string);
  }

  get address(): PostalAddress {
    return RequiredFrom.subjectPredicate(this, SCHEMA.address, TermAs.instance(PostalAddress));
  }

  /** The ISO 17442 LEI node (always illustrative in this demo). */
  get legalEntityIdentifier(): LegalEntityIdentifier {
    return RequiredFrom.subjectPredicate(
      this,
      CMNS.isIdentifiedBy,
      TermAs.instance(LegalEntityIdentifier),
    );
  }

  /** ISO 20275 entity legal form (design's illustrative scheme). */
  get legalForm(): string {
    return RequiredFrom.subjectPredicate(this, FIBO.hasLegalForm, NamedNodeAs.string);
  }
  set legalForm(value: string) {
    assertMember("legalForm", value, ENTITY_LEGAL_FORM_IRIS);
    RequiredAs.object(this, FIBO.hasLegalForm, value, NamedNodeFrom.string);
  }
}

/** design §3.2/§3.3 row 1 (kybshape:OrganisationalIdentityCredentialShape). */
export class OrganisationalIdentityCredential extends CredentialResource {
  override get resourceKind(): KybResourceKind {
    return "org-identity-credential";
  }

  get credentialSubject(): OrganisationalIdentitySubject {
    return RequiredFrom.subjectPredicate(
      this,
      CRED.credentialSubject,
      TermAs.instance(OrganisationalIdentitySubject),
    );
  }
}

/** One disclosed beneficial owner (kybshape:EntityOwnerShape). */
export class EntityOwner extends TypedNode {
  get ownerName(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.name, LiteralAs.string);
  }
  set ownerName(value: string) {
    RequiredAs.object(this, SCHEMA.name, value, LiteralFrom.string);
  }
}

/**
 * One disclosed ownership record (kybshape:EntityOwnershipShape,
 * `fibo-be-oac-opty:EntityOwnership`).
 */
export class EntityOwnership extends TypedNode {
  get owningEntity(): EntityOwner {
    return RequiredFrom.subjectPredicate(this, FIBO.hasOwningEntity, TermAs.instance(EntityOwner));
  }

  /** The owned business's own WebID. */
  get ownedEntityIri(): string {
    return RequiredFrom.subjectPredicate(this, FIBO.hasOwnedEntity, NamedNodeAs.string);
  }
  set ownedEntityIri(value: string) {
    RequiredAs.object(this, FIBO.hasOwnedEntity, value, NamedNodeFrom.string);
  }

  /** Disclosed display percentage (0..100), e.g. 42.00. */
  get ownershipPercentage(): number {
    return RequiredFrom.subjectPredicate(this, FIBO.hasOwnershipPercentage, LiteralAs.number);
  }
  set ownershipPercentage(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new RangeError(`ownershipPercentage must be in 0..100, got ${value}`);
    }
    RequiredAs.object(this, FIBO.hasOwnershipPercentage, value, literalFromXsdDecimal);
  }

  /** ZK field: 4-digit budget, filter_int_d4 (scene-3 predicate: bps >= 2500). */
  get ownershipPercentageBps(): number {
    return RequiredFrom.subjectPredicate(this, KYB.ownershipPercentageBps, LiteralAs.number);
  }
  set ownershipPercentageBps(value: number) {
    if (!fitsZkBudget(KYB.ownershipPercentageBps, value)) {
      throw new RangeError(
        `ownershipPercentageBps ${value} breaks the 4-digit ZK budget (0..10000 basis points)`,
      );
    }
    RequiredAs.object(this, KYB.ownershipPercentageBps, value, LiteralFrom.integer);
  }
}

/** Claims node of the beneficial-ownership VC (kybshape:BeneficialOwnershipSubjectShape). */
export class BeneficialOwnershipSubject extends TypedNode {
  /** The disclosed ownership set (>= 1; live write-through set). */
  get ownershipRecords(): Set<EntityOwnership> {
    return SetFrom.subjectPredicate(
      this,
      KYB.hasOwnershipRecord,
      TermAs.instance(EntityOwnership),
      (value, _factory) => TermAs.term(value),
    );
  }
}

/** design §3.2/§3.3 row 2 (kybshape:BeneficialOwnershipCredentialShape). */
export class BeneficialOwnershipCredential extends CredentialResource {
  override get resourceKind(): KybResourceKind {
    return "beneficial-ownership-credential";
  }

  get credentialSubject(): BeneficialOwnershipSubject {
    return RequiredFrom.subjectPredicate(
      this,
      CRED.credentialSubject,
      TermAs.instance(BeneficialOwnershipSubject),
    );
  }
}

/**
 * The named signatory/officer (kybshape:AuthorizedOfficerShape,
 * `fibo-be-oac-exec:Signatory`/`CorporateOfficer`).
 */
export class AuthorizedOfficer extends TypedNode {
  get officerName(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.name, LiteralAs.string);
  }
  set officerName(value: string) {
    RequiredAs.object(this, SCHEMA.name, value, LiteralFrom.string);
  }

  get jobTitle(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.jobTitle, LiteralAs.string);
  }
  set jobTitle(value: string) {
    RequiredAs.object(this, SCHEMA.jobTitle, value, LiteralFrom.string);
  }

  /** The business's own WebID this officer may sign for. */
  get hasSigningAuthorityForIri(): string {
    return RequiredFrom.subjectPredicate(this, FIBO.hasSigningAuthorityFor, NamedNodeAs.string);
  }
  set hasSigningAuthorityForIri(value: string) {
    RequiredAs.object(this, FIBO.hasSigningAuthorityFor, value, NamedNodeFrom.string);
  }

  /** The business's own WebID this officer is an officer of. */
  get isOfficerOfIri(): string {
    return RequiredFrom.subjectPredicate(this, FIBO.isOfficerOf, NamedNodeAs.string);
  }
  set isOfficerOfIri(value: string) {
    RequiredAs.object(this, FIBO.isOfficerOf, value, NamedNodeFrom.string);
  }
}

/** Claims node of the officer-authorization VC (kybshape:OfficerAuthorizationSubjectShape). */
export class OfficerAuthorizationSubject extends TypedNode {
  get authorizedOfficer(): AuthorizedOfficer {
    return RequiredFrom.subjectPredicate(
      this,
      KYB.hasAuthorizedOfficer,
      TermAs.instance(AuthorizedOfficer),
    );
  }
}

/** design §3.2/§3.3 row 3 (kybshape:OfficerAuthorizationCredentialShape). */
export class OfficerAuthorizationCredential extends CredentialResource {
  override get resourceKind(): KybResourceKind {
    return "officer-authorization-credential";
  }

  get credentialSubject(): OfficerAuthorizationSubject {
    return RequiredFrom.subjectPredicate(
      this,
      CRED.credentialSubject,
      TermAs.instance(OfficerAuthorizationSubject),
    );
  }
}

/** design §3.3 row 4: the bank-written CDD decision record (kybshape:CddDecisionRecordShape). */
export class CddDecisionRecord extends KybResource {
  override get resourceKind(): KybResourceKind {
    return "cdd-decision-record";
  }

  get decisionStatus(): string {
    return RequiredFrom.subjectPredicate(this, KYB.cddDecisionStatus, NamedNodeAs.string);
  }
  set decisionStatus(value: string) {
    assertMember("decisionStatus", value, CDD_DECISION_STATUS_IRIS);
    RequiredAs.object(this, KYB.cddDecisionStatus, value, NamedNodeFrom.string);
  }

  get checkDate(): Date {
    return RequiredFrom.subjectPredicate(this, KYB.cddCheckDate, LiteralAs.date);
  }
  set checkDate(value: Date) {
    RequiredAs.object(this, KYB.cddCheckDate, value, literalFromXsdDate);
  }

  /** The credential pod-resource IRIs checked (>= 1; live write-through set — the freshness trail). */
  get checkedCredentialIris(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      KYB.checkedCredential,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}

/** Claims node of the ZK operand anchor (kybshape:ZkOperandAnchorSubjectShape). */
export class ZkOperandAnchorSubject extends TypedNode {
  /** The anchored ZK field IRI (only kyb:ownershipPercentageBps in this demo). */
  get fieldIri(): string {
    return RequiredFrom.subjectPredicate(this, KYB.field, NamedNodeAs.string);
  }
  set fieldIri(value: string) {
    assertMember("fieldIri", value, ZK_ANCHORABLE_FIELD_IRIS);
    RequiredAs.object(this, KYB.field, value, NamedNodeFrom.string);
  }

  /** Deterministic salt-free sparq operand encoding (0x-prefixed lowercase hex). */
  get operandEnc(): string {
    return RequiredFrom.subjectPredicate(this, KYB.operandEnc, LiteralAs.string);
  }
  set operandEnc(value: string) {
    if (!/^0x[0-9a-f]{1,64}$/.test(value)) {
      throw new RangeError("operandEnc must be a 0x-prefixed lowercase hex field element");
    }
    RequiredAs.object(this, KYB.operandEnc, value, LiteralFrom.string);
  }
}

/**
 * The issuer-signed operand-anchor VC that makes the scene-3 Tier-A live
 * filter proof forgery-resistant (kybshape:ZkOperandAnchorShape). Never ship
 * a Tier-A surface without the anchor check.
 */
export class ZkOperandAnchor extends CredentialResource {
  override get resourceKind(): KybResourceKind {
    return "zk-operand-anchor";
  }

  get credentialSubject(): ZkOperandAnchorSubject {
    return RequiredFrom.subjectPredicate(
      this,
      CRED.credentialSubject,
      TermAs.instance(ZkOperandAnchorSubject),
    );
  }
}
