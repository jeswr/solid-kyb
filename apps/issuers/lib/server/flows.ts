/**
 * The three issuer flows (design §3.2, §5 scene 1 "fill the vault"):
 * Organisational-Identity + Officer-Authorization (GLEIF-modelled, same
 * issuer seat — design §3.2 row 3 note) and Beneficial-Ownership (unbranded
 * registry/FinCEN-BO-source-modelled).
 *
 * Claims are PINNED to the walkthrough's single played business (Northwind
 * Logistics LLC — `@kyb/data-model`'s `PERSONA_VALUES[0]`) — a request can
 * only select a flow, never a value, so `/api/issue` can never become a
 * signing oracle. These are the SAME values `@kyb/data-model`'s `personas()`
 * builds at fixture time, and the SAME pod paths
 * (`RESOURCE_POD_PATHS`/`@kyb/data-model`), so a business that mixes seeding
 * and live issuance lands on one canonical resource per credential kind.
 *
 * ZK operand anchors (design §4): the Beneficial-Ownership flow mints
 * `kyb:ZkOperandAnchor` credentials beside the disclosed credential —
 * `kyb:beneficialOwnershipArrayCommitment` (Tier B, computed in pure JS via
 * Blake3, always real) and one `kyb:ownershipPercentageBps` anchor per owner
 * (Tier A, needs the sparq native `encode_int_literal` bridge —
 * `SPARQ_CHECKOUT` — see `./issuer-rail.ts`'s honest gating).
 */
import { KYB, PERSONA_VALUES, type PersonaValues, RESOURCE_POD_PATHS } from "@kyb/data-model";
import type {
  BeneficialOwnershipClaims,
  CredentialKind,
  OfficerAuthorizationClaims,
  OrganisationalIdentityClaims,
} from "@kyb/vc-kit";
import type { IssuerFlowId } from "./config";

/** The walkthrough's single played business (design §7; fictional, pinned). */
function northwindLogistics(): PersonaValues {
  const values = PERSONA_VALUES[0];
  if (values === undefined || values.id !== "northwind-logistics") {
    throw new Error("@kyb/data-model PERSONA_VALUES is missing the northwind-logistics persona");
  }
  return values;
}

export const PERSONA = northwindLogistics();

const LEGAL_FORM_IRI: Record<PersonaValues["legalFormLocalName"], string> = {
  Corp: KYB.EntityLegalForm_Corp,
  LLC: KYB.EntityLegalForm_LLC,
  LLP: KYB.EntityLegalForm_LLP,
};

/** One owner's pinned basis-points value + display name (for the beneficial-ownership flow's anchors). */
export interface OwnerAnchorSpec {
  readonly index: number;
  readonly name: string;
  readonly ownershipPercentageBps: number;
  /** Pod-root-relative path for this owner's Tier A `kyb:ownershipPercentageBps` anchor. */
  readonly path: string;
}

export const OWNER_ANCHORS: readonly OwnerAnchorSpec[] = PERSONA.owners.map((owner, index) => ({
  index,
  name: owner.name,
  ownershipPercentageBps: owner.ownershipPercentageBps,
  path: `/kyb/credentials/zk/owner-${index}-bps`,
}));

/** Pod-root-relative path for the Tier B owner-array-commitment anchor. */
export const ARRAY_COMMITMENT_ANCHOR_PATH =
  "/kyb/credentials/zk/beneficial-ownership-array-commitment";

export interface IssuerFlowDefinition {
  readonly id: IssuerFlowId;
  /** Role-first display label ("modelled on X" framing, never "by X"). */
  readonly label: string;
  /** The modelled organisation(s). */
  readonly modelledOn: string;
  /** The journey role. */
  readonly role: string;
  readonly kind: CredentialKind;
  /** Pod-root-relative credential path. */
  readonly credentialPath: string;
  /** Validity window offsets from the issue instant, in days. */
  readonly validFromDays: number;
  readonly validUntilDays: number;
  /** The PINNED demo claims this flow signs (never request-supplied). */
  readonly claims: () =>
    | OrganisationalIdentityClaims
    | BeneficialOwnershipClaims
    | OfficerAuthorizationClaims;
  /** Whether this flow mints ZK operand anchors (only beneficial-ownership does, design §4). */
  readonly mintsAnchors: boolean;
}

export const ISSUER_FLOWS: Readonly<Record<IssuerFlowId, IssuerFlowDefinition>> = {
  "beneficial-ownership": {
    claims: (): BeneficialOwnershipClaims => ({
      kind: "beneficial-ownership-credential",
      ownershipRecords: PERSONA.owners.map((owner) => ({
        ownerName: owner.name,
        ownershipPercentage: owner.ownershipPercentage,
        ownershipPercentageBps: owner.ownershipPercentageBps,
      })),
    }),
    credentialPath: RESOURCE_POD_PATHS["beneficial-ownership-credential"],
    id: "beneficial-ownership",
    kind: "beneficial-ownership-credential",
    label:
      "Beneficial-ownership verification — modelled on an unbranded business registry / FinCEN BO data source",
    mintsAnchors: true,
    modelledOn: "an unbranded business registry / FinCEN BO data source",
    role: "beneficial-ownership data source",
    validFromDays: -60,
    validUntilDays: 305,
  },
  "officer-authorization": {
    claims: (): OfficerAuthorizationClaims => {
      const managingOfficer = PERSONA.owners[0];
      if (managingOfficer === undefined) throw new Error("persona has no owners");
      return {
        kind: "officer-authorization-credential",
        officer: {
          jobTitle: PERSONA.managingOfficerJobTitle,
          officerName: managingOfficer.name,
        },
      };
    },
    credentialPath: RESOURCE_POD_PATHS["officer-authorization-credential"],
    id: "officer-authorization",
    kind: "officer-authorization-credential",
    label: "Officer authorization — modelled on GLEIF (vLEI OOR/ECR analogue)",
    mintsAnchors: false,
    modelledOn: "GLEIF",
    role: "organisational-identity + officer-role issuer",
    validFromDays: -60,
    validUntilDays: 305,
  },
  "org-identity": {
    claims: (): OrganisationalIdentityClaims => ({
      address: PERSONA.homeAddress,
      businessName: PERSONA.businessName,
      kind: "org-identity-credential",
      legalForm: LEGAL_FORM_IRI[PERSONA.legalFormLocalName],
      lei: PERSONA.lei,
    }),
    credentialPath: RESOURCE_POD_PATHS["org-identity-credential"],
    id: "org-identity",
    kind: "org-identity-credential",
    label: "Organisational-identity verification — modelled on GLEIF (LEI-anchored)",
    mintsAnchors: false,
    modelledOn: "GLEIF",
    role: "organisational-identity + officer-role issuer",
    validFromDays: -60,
    validUntilDays: 305,
  },
};
