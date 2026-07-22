/**
 * Typed claim construction for the four KYB credential kinds (design §3.2/§4),
 * built through `@kyb/data-model`'s own typed wrapper builders
 * (`buildOrganisationalIdentityCredential` et al.) - vc-kit never hand-builds
 * quads for the credential subject graph; it only supplies the W3C VC 2.0
 * envelope (issuer/subject/validity/status) around whatever data-model
 * constructs, then signs. The matching SHACL shape (validated inside
 * `finishIssue`, BEFORE signing) is the authority on semantic validity; the
 * guards here only protect structural safety (IRI injection) the RDF layer
 * itself does not enforce for envelope-level values vc-kit itself supplies.
 */

import type {
  AuthorizedOfficerInit,
  BeneficialOwnershipCredentialInit,
  EntityOwnershipInit,
  KybResource,
  OfficerAuthorizationCredentialInit,
  OrganisationalIdentityCredentialInit,
  PostalAddressInit,
  ZkOperandAnchorInit,
} from "@kyb/data-model";
import {
  buildBeneficialOwnershipCredential,
  buildOfficerAuthorizationCredential,
  buildOrganisationalIdentityCredential,
  buildZkOperandAnchor,
} from "@kyb/data-model";
import type { CredentialKind } from "./vocab.ts";

/** A structured claim-construction failure (thrown BEFORE anything is signed). */
export class ClaimInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimInputError";
  }
}

/**
 * Reject values that cannot be an absolute IRI reference. `n3.Writer` does not
 * escape IRIs, so an unchecked value could break out of its `<...>` token when
 * the graph is serialised - every IRI vc-kit itself hands to a data-model
 * builder passes this gate first (defense-in-depth around the envelope
 * fields vc-kit owns: credentialId, issuer, subject).
 */
export function assertAbsoluteIri(value: string, label: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what an IRI reference must not contain
  if (/[\u0000-\u0020<>"{}|^`\\]/.test(value) || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    throw new ClaimInputError(
      `${label} is not an absolute IRI reference: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** Organisational-identity VC subject claims (design §3.2 row 1). */
export interface OrganisationalIdentityClaims {
  readonly kind: "org-identity-credential";
  readonly businessName: string;
  readonly address: PostalAddressInit;
  /** ISO 17442 lexical form - always illustrative in this demo. */
  readonly lei: string;
  /** One of `ENTITY_LEGAL_FORM_IRIS` (`@kyb/data-model`). */
  readonly legalForm: string;
}

/** Beneficial-ownership VC subject claims (design §3.2 row 2; the ONE ZK-participating credential). */
export interface BeneficialOwnershipClaims {
  readonly kind: "beneficial-ownership-credential";
  readonly ownershipRecords: readonly EntityOwnershipInit[];
}

/** Officer-authorization VC subject claims (design §3.2 row 3). */
export interface OfficerAuthorizationClaims {
  readonly kind: "officer-authorization-credential";
  readonly officer: AuthorizedOfficerInit;
}

/**
 * ZK operand-anchor VC subject claims: the issuer-signed binding of a hidden
 * field's deterministic term encoding/commitment. Anchors BOTH the Tier A
 * per-owner field (`kyb:ownershipPercentageBps`) and the Tier B owner-array
 * commitment (`kyb:beneficialOwnershipArrayCommitment`).
 */
export interface ZkOperandAnchorClaims {
  readonly kind: "zk-operand-anchor";
  /** The anchored field IRI - one of `ZK_ANCHORABLE_FIELD_IRIS` (`@kyb/data-model`). */
  readonly field: string;
  /** `0x`-prefixed lowercase hex field element (the circuit's public operand). */
  readonly operandEnc: string;
}

/** The typed claims union - discriminated by the credential kind. */
export type KybCredentialClaims =
  | OrganisationalIdentityClaims
  | BeneficialOwnershipClaims
  | OfficerAuthorizationClaims
  | ZkOperandAnchorClaims;

/** The W3C VC 2.0 envelope vc-kit itself owns (issue.ts assembles this). */
export interface CredentialEnvelope {
  readonly credentialId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly validFrom: Date;
  readonly validUntil?: Date;
  readonly credentialStatus: string;
}

/** The shared `CredentialEnvelopeInit` shape every data-model builder takes. */
interface BuilderEnvelopeInit {
  readonly iri: string;
  readonly issuer: string;
  readonly validFrom: Date;
  readonly validUntil?: Date;
  readonly credentialStatus: string;
  readonly credentialSubject: string;
}

function envelopeInit(envelope: CredentialEnvelope): BuilderEnvelopeInit {
  return {
    iri: assertAbsoluteIri(envelope.credentialId, "credentialId"),
    issuer: assertAbsoluteIri(envelope.issuer, "issuer"),
    validFrom: envelope.validFrom,
    ...(envelope.validUntil !== undefined ? { validUntil: envelope.validUntil } : {}),
    credentialStatus: assertAbsoluteIri(envelope.credentialStatus, "credentialStatus"),
    credentialSubject: assertAbsoluteIri(envelope.subject, "subject WebID"),
  };
}

/**
 * Build the FULL unsigned credential resource (envelope + subject claims)
 * through `@kyb/data-model`'s typed builders. Throws {@link ClaimInputError}
 * on structurally unsafe envelope input; the builders' own setters throw
 * `RangeError` on cheap invariant violations (ZK digit budget, controlled
 * vocabulary, masked/illustrative identifiers); full semantic validity is the
 * SHACL shape gate's job in `finishIssue`.
 */
export function buildKybCredentialResource(
  kind: CredentialKind,
  envelope: CredentialEnvelope,
  claims: KybCredentialClaims,
): KybResource {
  if (claims.kind !== kind) {
    throw new ClaimInputError(`claims.kind ${claims.kind} does not match kind ${kind}`);
  }
  const base = envelopeInit(envelope);
  switch (claims.kind) {
    case "org-identity-credential": {
      const init: OrganisationalIdentityCredentialInit = {
        ...base,
        businessName: claims.businessName,
        address: claims.address,
        lei: claims.lei,
        legalForm: claims.legalForm,
      };
      return buildOrganisationalIdentityCredential(init);
    }
    case "beneficial-ownership-credential": {
      const init: BeneficialOwnershipCredentialInit = {
        ...base,
        ownedEntity: envelope.subject,
        ownershipRecords: claims.ownershipRecords,
      };
      return buildBeneficialOwnershipCredential(init);
    }
    case "officer-authorization-credential": {
      const init: OfficerAuthorizationCredentialInit = {
        ...base,
        business: envelope.subject,
        officer: claims.officer,
      };
      return buildOfficerAuthorizationCredential(init);
    }
    case "zk-operand-anchor": {
      const init: ZkOperandAnchorInit = {
        ...base,
        field: claims.field,
        operandEnc: claims.operandEnc,
      };
      return buildZkOperandAnchor(init);
    }
    default: {
      const exhaustive: never = claims;
      throw new ClaimInputError(`unsupported claims kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}
