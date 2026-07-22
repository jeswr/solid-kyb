// Generated from shapes/*.ttl by scripts/generate-shapes.mjs - DO NOT EDIT.
// Regenerate from packages/data-model: node scripts/generate-shapes.mjs

/**
 * Turtle source of every SHACL shapes document, keyed by its file stem in
 * shapes/ ("common" holds the shared support shapes the resource shapes
 * reference via sh:node).
 */
export const SHAPES_TURTLE = {
  "beneficial-ownership-credential": `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix cred: <https://www.w3.org/2018/credentials#> .
@prefix sec: <https://w3id.org/security#> .
@prefix kyb: <https://solid-kyb-vocab.vercel.app/kyb#> .
@prefix kybshape: <https://solid-kyb-vocab.vercel.app/kyb/shapes#> .

# design §3.2/§3.3 row 2: the VC listing every disclosed beneficial owner's
# stake, issued by the unbranded registry/FinCEN-BO-source-modelled seat
# (scene 1). Holder-bound to the business's own WebID. The ONLY
# ZK-participating KYB credential (design §4): the per-owner
# kyb:ownershipPercentageBps values are the ZK operand for the scene-3
# completeness/threshold predicate — never disclose a ZK-hiding-defeating
# derivative alongside them (the closed shape below enforces this the same
# way the lending demo's EmploymentIncomeSubjectShape does).
kybshape:BeneficialOwnershipCredentialShape
  a sh:NodeShape ;
  sh:targetClass kyb:BeneficialOwnershipCredential ;
  sh:closed true ;
  sh:ignoredProperties ( sec:proof ) ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue cred:VerifiableCredential ;
  ] ;
  sh:property [
    sh:path cred:issuer ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path cred:validFrom ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
    sh:lessThan cred:validUntil ;
  ] ;
  sh:property [
    sh:path cred:validUntil ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
  ] ;
  sh:property [
    sh:path cred:credentialStatus ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
  ] ;
  sh:property [
    sh:path cred:credentialSubject ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:node kybshape:BeneficialOwnershipSubjectShape ;
    sh:message "credentialSubject must be the business's own WebID (holder binding)" ;
  ] ;
  sh:property [
    sh:path cred:credentialSchema ;
    sh:nodeKind sh:IRI ;
  ] .

# The disclosed ownership set. At least one member; the design persona pins
# exactly four (design §7) but the shape only requires >= 1 — the
# sum-to-10000bps invariant is a data-seed-time check, not SHACL-expressible
# (design §3.3), same as the lending loan-offer arithmetic identity.
kybshape:BeneficialOwnershipSubjectShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:ignoredProperties ( rdf:type ) ;
  sh:property [
    sh:path kyb:hasOwnershipRecord ;
    sh:minCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node kybshape:EntityOwnershipShape ;
  ] .
`,
  "cdd-decision-record": `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix kyb: <https://solid-kyb-vocab.vercel.app/kyb#> .
@prefix kybshape: <https://solid-kyb-vocab.vercel.app/kyb/shapes#> .

# design §3.3 row 4, \`/kyb/decision\`: a bank's own record that it satisfied
# the FinCEN CDD Rule (31 CFR §1010.230) for this business customer.
# Bank-written (lives in the bank's own system/pod, not the business vault);
# not a W3C VC envelope in this demo (design §3.3 lists only status, check
# date, and the checked-credential freshness trail — no issuer/holder
# binding fields).
kybshape:CddDecisionRecordShape
  a sh:NodeShape ;
  sh:targetClass kyb:CddDecisionRecord ;
  sh:closed true ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue kyb:CddDecisionRecord ;
  ] ;
  sh:property [
    sh:path kyb:cddDecisionStatus ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:in ( kyb:CddDecisionStatus-Opened kyb:CddDecisionStatus-Declined kyb:CddDecisionStatus-PendingReview ) ;
    sh:message "cddDecisionStatus must be one of the demo's three decision-status individuals" ;
  ] ;
  sh:property [
    sh:path kyb:cddCheckDate ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:date ;
  ] ;
  sh:property [
    # The freshness audit trail: which specific org-identity/BO credential
    # VERSIONS (pod-resource IRIs) were checked.
    sh:path kyb:checkedCredential ;
    sh:minCount 1 ;
    sh:nodeKind sh:IRI ;
  ] .
`,
  common: `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix schema: <https://schema.org/> .
@prefix cmns-org: <https://www.omg.org/spec/Commons/Organizations/> .
@prefix fibo-be-oac-opty: <https://spec.edmcouncil.org/fibo/ontology/BE/OwnershipAndControl/OwnershipParties/> .
@prefix fibo-be-le-lei: <https://spec.edmcouncil.org/fibo/ontology/BE/LegalEntities/LEIEntities/> .
@prefix kyb: <https://solid-kyb-vocab.vercel.app/kyb#> .
@prefix kybshape: <https://solid-kyb-vocab.vercel.app/kyb/shapes#> .

# Shared support shapes referenced (sh:node) by the resource shapes. None
# declares a target: they validate only where a resource shape points at
# them. Shape identities live under the demo's own published-URL namespace
# (design §3.5 / CLAUDE.md rule 3: no urn:example: placeholders, only real
# namespaces we control).

kybshape:PostalAddressShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue schema:PostalAddress ;
  ] ;
  sh:property [
    sh:path schema:streetAddress ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:minLength 1 ;
  ] ;
  sh:property [
    sh:path schema:addressLocality ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:minLength 1 ;
  ] ;
  sh:property [
    sh:path schema:addressRegion ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:pattern "^[A-Z]{2}$" ;
    sh:message "addressRegion must be a two-letter US state code" ;
  ] ;
  sh:property [
    sh:path schema:postalCode ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:pattern "^[0-9]{5}(-[0-9]{4})?$" ;
    sh:message "postalCode must be a US ZIP or ZIP+4" ;
  ] .

# The disclosed ISO 17442 legal entity identifier node
# (fibo-be-le-lei:LegalEntityIdentifier). kyb:isIllustrativeLei must be
# \`true\` in this demo — no surface may render a value that could be mistaken
# for a real GLEIF-issued LEI (design §7, §9 open question 3).
kybshape:LegalEntityIdentifierShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue fibo-be-le-lei:LegalEntityIdentifier ;
  ] ;
  sh:property [
    sh:path schema:identifier ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:pattern "^[0-9A-Z]{18}[0-9]{2}$" ;
    sh:message "the LEI must be the ISO 17442 lexical form: 18 alphanumeric characters plus a 2-digit numeric checksum" ;
  ] ;
  sh:property [
    sh:path kyb:isIllustrativeLei ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:boolean ;
    sh:hasValue true ;
    sh:message "isIllustrativeLei must be true: this demo never carries a real GLEIF-issued LEI" ;
  ] .

# One disclosed beneficial-ownership record (fibo-be-oac-opty:EntityOwnership).
# hasOwningEntity range per FIBO's own restriction is cmns-org:LegalPerson;
# the owner node is additionally typed fibo-be-oac-opty:EntityOwner and
# schema:Person for display. hasOwnedEntity is an IRI reference to the
# business's own WebID (no embedded node — the business's identity is
# declared once, by the organisational-identity credential).
kybshape:EntityOwnershipShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue fibo-be-oac-opty:EntityOwnership ;
  ] ;
  sh:property [
    sh:path fibo-be-oac-opty:hasOwningEntity ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node kybshape:EntityOwnerShape ;
  ] ;
  sh:property [
    sh:path fibo-be-oac-opty:hasOwnedEntity ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:message "hasOwnedEntity must reference the owned business's own WebID" ;
  ] ;
  sh:property [
    # Disclosed display percentage (design §3.4 binding table).
    sh:path fibo-be-le-lei:hasOwnershipPercentage ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:decimal ;
    sh:minInclusive 0.0 ;
    sh:maxInclusive 100.0 ;
  ] ;
  sh:property [
    # ZK field: 4-digit budget, sparq filter_int_d4 (scene-3 predicate:
    # ownershipPercentageBps >= 2500, i.e. the CDD Rule's 25% threshold).
    sh:path kyb:ownershipPercentageBps ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:integer ;
    sh:minInclusive 0 ;
    sh:maxInclusive 10000 ;
    sh:message "ownershipPercentageBps must fit the 4-digit ZK budget (0..10000 basis points)" ;
  ] .

kybshape:EntityOwnerShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:ignoredProperties ( rdf:type ) ;
  sh:property [
    sh:path schema:name ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:minLength 1 ;
  ] .
`,
  "officer-authorization-credential": `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix cred: <https://www.w3.org/2018/credentials#> .
@prefix sec: <https://w3id.org/security#> .
@prefix schema: <https://schema.org/> .
@prefix fibo-be-oac-exec: <https://spec.edmcouncil.org/fibo/ontology/BE/OwnershipAndControl/Executives/> .
@prefix kyb: <https://solid-kyb-vocab.vercel.app/kyb#> .
@prefix kybshape: <https://solid-kyb-vocab.vercel.app/kyb/shapes#> .

# design §3.2/§3.3 row 3: the vLEI OOR/ECR-role-credential analogue —
# records that a natural person has authority to sign for / bind the
# business. Issued by the same GLEIF-modelled issuer surface as the
# organisational-identity credential. Holder-bound to the business's own
# WebID (house rule); the embedded kyb:AuthorizedOfficer node names the
# specific individual and carries fibo-be-oac-exec:hasSigningAuthorityFor
# back to the business.
kybshape:OfficerAuthorizationCredentialShape
  a sh:NodeShape ;
  sh:targetClass kyb:OfficerAuthorizationCredential ;
  sh:closed true ;
  sh:ignoredProperties ( sec:proof ) ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue cred:VerifiableCredential ;
  ] ;
  sh:property [
    sh:path cred:issuer ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path cred:validFrom ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
    sh:lessThan cred:validUntil ;
  ] ;
  sh:property [
    sh:path cred:validUntil ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
  ] ;
  sh:property [
    sh:path cred:credentialStatus ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
  ] ;
  sh:property [
    sh:path cred:credentialSubject ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:node kybshape:OfficerAuthorizationSubjectShape ;
    sh:message "credentialSubject must be the business's own WebID (holder binding)" ;
  ] ;
  sh:property [
    sh:path cred:credentialSchema ;
    sh:nodeKind sh:IRI ;
  ] .

kybshape:OfficerAuthorizationSubjectShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:ignoredProperties ( rdf:type ) ;
  sh:property [
    sh:path kyb:hasAuthorizedOfficer ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node kybshape:AuthorizedOfficerShape ;
  ] .

# The signatory/officer (fibo-be-oac-exec:Signatory, CorporateOfficer):
# hasSigningAuthorityFor's domain is Signatory and isOfficerOf's domain is
# CorporateOfficer, so both types are asserted on this node (verified
# 2026-07-22 against the fetched Executives module).
kybshape:AuthorizedOfficerShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue fibo-be-oac-exec:Signatory ;
  ] ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue fibo-be-oac-exec:CorporateOfficer ;
  ] ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue schema:Person ;
  ] ;
  sh:property [
    sh:path schema:name ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:minLength 1 ;
  ] ;
  sh:property [
    sh:path schema:jobTitle ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:minLength 1 ;
  ] ;
  sh:property [
    sh:path fibo-be-oac-exec:hasSigningAuthorityFor ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:message "hasSigningAuthorityFor must reference the business's own WebID" ;
  ] ;
  sh:property [
    sh:path fibo-be-oac-exec:isOfficerOf ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:message "isOfficerOf must reference the business's own WebID" ;
  ] .
`,
  "org-identity-credential": `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix cred: <https://www.w3.org/2018/credentials#> .
@prefix sec: <https://w3id.org/security#> .
@prefix schema: <https://schema.org/> .
@prefix cmns-id: <https://www.omg.org/spec/Commons/Identifiers/> .
@prefix fibo-be-le-lei: <https://spec.edmcouncil.org/fibo/ontology/BE/LegalEntities/LEIEntities/> .
@prefix fibo-be-le-lp: <https://spec.edmcouncil.org/fibo/ontology/BE/LegalEntities/LegalPersons/> .
@prefix kyb: <https://solid-kyb-vocab.vercel.app/kyb#> .
@prefix kybshape: <https://solid-kyb-vocab.vercel.app/kyb/shapes#> .

# design §3.2/§3.3 row 1: the LEI-anchored organisational-identity VC issued
# by the GLEIF-modelled org-identity seat (scene 1). Holder-bound: per the
# suite's house rule, credentialSubject is the WebID of whoever holds the
# pod this resource lives in — for the KYB vault that is the business's own
# WebID (Northwind Logistics LLC's own profile), not an individual officer's.
kybshape:OrganisationalIdentityCredentialShape
  a sh:NodeShape ;
  sh:targetClass kyb:OrganisationalIdentityCredential ;
  sh:closed true ;
  sh:ignoredProperties ( sec:proof ) ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue cred:VerifiableCredential ;
  ] ;
  sh:property [
    sh:path cred:issuer ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path cred:validFrom ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
    sh:lessThan cred:validUntil ;
  ] ;
  sh:property [
    sh:path cred:validUntil ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
  ] ;
  sh:property [
    sh:path cred:credentialStatus ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
  ] ;
  sh:property [
    sh:path cred:credentialSubject ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:node kybshape:OrganisationalIdentitySubjectShape ;
    sh:message "credentialSubject must be the business's own WebID (holder binding)" ;
  ] ;
  sh:property [
    sh:path cred:credentialSchema ;
    sh:nodeKind sh:IRI ;
  ] .

# The business's own identity facts, disclosed (CDD needs the actual LEI and
# entity-form values — this credential is never ZK-proved, design §3.2).
kybshape:OrganisationalIdentitySubjectShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue fibo-be-le-lei:LEIRegisteredEntity ;
  ] ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue fibo-be-le-lp:BusinessEntity ;
  ] ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue schema:Organization ;
  ] ;
  sh:property [
    sh:path schema:name ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:minLength 1 ;
  ] ;
  sh:property [
    sh:path schema:address ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node kybshape:PostalAddressShape ;
  ] ;
  sh:property [
    # ISO 17442 LEI, illustrative-only (kybshape:LegalEntityIdentifierShape
    # requires kyb:isIllustrativeLei = true).
    sh:path cmns-id:isIdentifiedBy ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node kybshape:LegalEntityIdentifierShape ;
  ] ;
  sh:property [
    # ISO 20275 entity legal form (illustrative scheme, kyb:EntityLegalFormScheme).
    sh:path fibo-be-le-lei:hasLegalForm ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:in ( kyb:EntityLegalForm-LLC kyb:EntityLegalForm-Corp kyb:EntityLegalForm-LLP ) ;
    sh:message "hasLegalForm must be one of the demo's illustrative entity-legal-form individuals" ;
  ] .
`,
  "zk-operand-anchor": `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix cred: <https://www.w3.org/2018/credentials#> .
@prefix sec: <https://w3id.org/security#> .
@prefix kyb: <https://solid-kyb-vocab.vercel.app/kyb#> .
@prefix kybshape: <https://solid-kyb-vocab.vercel.app/kyb/shapes#> .

# design §4: the issuer-signed operand-anchor VC that makes the Tier-A
# per-owner threshold proof (scene 3: ownershipPercentageBps >= 2500)
# forgery-resistant. A bare filter proof is fully forgeable (operand_enc is
# deterministic and salt-free); verifiers MUST check anchor signature +
# issuer trust + status + subject WebID == authenticated presenter +
# anchor.operandEnc == proof public input + challenge freshness. Never ship
# a Tier-A surface without the anchor check (same house rule as the lending
# demo's lend:ZkOperandAnchor).
kybshape:ZkOperandAnchorShape
  a sh:NodeShape ;
  sh:targetClass kyb:ZkOperandAnchor ;
  sh:closed true ;
  sh:ignoredProperties ( sec:proof ) ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue cred:VerifiableCredential ;
  ] ;
  sh:property [
    sh:path cred:issuer ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path cred:validFrom ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
    sh:lessThan cred:validUntil ;
  ] ;
  sh:property [
    # Anchors are revoked via credentialStatus rather than expiring, but an
    # explicit window is permitted.
    sh:path cred:validUntil ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
  ] ;
  sh:property [
    sh:path cred:credentialStatus ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
  ] ;
  sh:property [
    sh:path cred:credentialSubject ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:node kybshape:ZkOperandAnchorSubjectShape ;
    sh:message "credentialSubject must be the holder WebID the verifier matches against the DPoP-bound session" ;
  ] ;
  sh:property [
    sh:path cred:credentialSchema ;
    sh:nodeKind sh:IRI ;
  ] .

kybshape:ZkOperandAnchorSubjectShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:ignoredProperties ( rdf:type ) ;
  sh:property [
    # Only the one KYB ZK field is anchorable in this demo (design §4).
    sh:path kyb:field ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:in ( kyb:ownershipPercentageBps kyb:beneficialOwnershipArrayCommitment ) ;
    sh:message "field must be an anchorable KYB ZK field (per-owner bps, or the Tier B owner-array commitment)" ;
  ] ;
  sh:property [
    # Deterministic salt-free sparq term encoding: 0x-prefixed lowercase hex
    # field element, equal to the filter circuit's public operand_enc input.
    sh:path kyb:operandEnc ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:pattern "^0x[0-9a-f]{1,64}$" ;
    sh:message "operandEnc must be a 0x-prefixed lowercase hex field element" ;
  ] .
`,
} as const;

/** Document keys of the bundled SHACL shapes. */
export type ShapesDocumentKey = keyof typeof SHAPES_TURTLE;

/** Every bundled shapes document, in one Turtle-parseable list. */
export const ALL_SHAPES_DOCUMENTS: readonly string[] = Object.values(SHAPES_TURTLE);

/** File stem of the 6 bundled shapes documents. */
export const SHAPES_DOCUMENT_KEYS = Object.keys(SHAPES_TURTLE) as readonly ShapesDocumentKey[];
