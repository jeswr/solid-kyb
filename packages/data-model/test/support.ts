/**
 * Shared test rig for the data-model suite: a fixed instant (the library
 * never reads the clock, so the suite doesn't either) and canonical builder
 * inits derived from the persona values, so tests and fixtures cannot drift
 * from the walkthrough card.
 */
import { PERSONA_VALUES, type PersonaValues } from "../src/personas.ts";
import type {
  BeneficialOwnershipCredentialInit,
  CredentialEnvelopeInit,
  OfficerAuthorizationCredentialInit,
  OrganisationalIdentityCredentialInit,
} from "../src/wrappers/build.ts";
import { KYB } from "../src/vocab/kyb.ts";

export const NOW = new Date("2026-07-22T12:00:00Z");
export const DAY_MS = 24 * 60 * 60 * 1000;

export const WEBID = "https://northwind.pod.example/profile/card#me";
export const ISSUER = "https://issuers.example/orgs/org-identity-registrar#id";

export function northwind(): PersonaValues {
  const values = PERSONA_VALUES[0];
  if (values === undefined) throw new Error("persona values missing");
  return values;
}

export function envelope(iri: string, overrides: Partial<CredentialEnvelopeInit> = {}) {
  return {
    iri,
    issuer: ISSUER,
    validFrom: new Date(NOW.getTime() - 60 * DAY_MS),
    validUntil: new Date(NOW.getTime() + 305 * DAY_MS),
    credentialStatus: "https://issuers.example/status/org-identity#42",
    credentialSubject: WEBID,
    ...overrides,
  } satisfies CredentialEnvelopeInit;
}

export function orgIdentityInit(): OrganisationalIdentityCredentialInit {
  const values = northwind();
  return {
    ...envelope("https://northwind.pod.example/kyb/credentials/org-identity"),
    businessName: values.businessName,
    address: values.homeAddress,
    lei: values.lei,
    legalForm: KYB.EntityLegalForm_LLC,
  };
}

export function beneficialOwnershipInit(): BeneficialOwnershipCredentialInit {
  const values = northwind();
  return {
    ...envelope("https://northwind.pod.example/kyb/credentials/beneficial-ownership"),
    ownedEntity: WEBID,
    ownershipRecords: values.owners.map((owner) => ({
      ownerName: owner.name,
      ownershipPercentage: owner.ownershipPercentage,
      ownershipPercentageBps: owner.ownershipPercentageBps,
    })),
  };
}

export function officerAuthorizationInit(): OfficerAuthorizationCredentialInit {
  const values = northwind();
  const managingOfficer = values.owners[0];
  if (managingOfficer === undefined) throw new Error("persona must have an owner");
  return {
    ...envelope("https://northwind.pod.example/kyb/credentials/officer-authorization"),
    business: WEBID,
    officer: {
      officerName: managingOfficer.name,
      jobTitle: values.managingOfficerJobTitle,
    },
  };
}
