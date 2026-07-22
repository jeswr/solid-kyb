/**
 * Wrapper gates: every builder produces a document its shape accepts and its
 * typed accessors read back; the cheap invariants (ZK digit budget,
 * controlled vocabularies, illustrative-LEI marker) throw at the setter; and
 * the serialize path is fail-closed (closed-shape checks refuse
 * non-conforming documents before any bytes leave the process).
 */
import { expect, test } from "vitest";
import {
  buildBeneficialOwnershipCredential,
  buildCddDecisionRecord,
  buildOfficerAuthorizationCredential,
  buildOrganisationalIdentityCredential,
  buildZkOperandAnchor,
  KYB,
  resourceToTurtle,
  ShapeViolationError,
  validate,
} from "../src/index.ts";
import {
  beneficialOwnershipInit,
  envelope,
  northwind,
  NOW,
  officerAuthorizationInit,
  orgIdentityInit,
  WEBID,
} from "./support.ts";

test("organisational-identity credential: build, serialise, read back", async () => {
  const credential = buildOrganisationalIdentityCredential(orgIdentityInit());
  const turtle = await resourceToTurtle(credential);
  expect(turtle).toContain("Northwind Logistics LLC");
  const subject = credential.credentialSubject;
  expect(subject.businessName).toBe(northwind().businessName);
  expect(subject.address.addressRegion).toBe("MO");
  expect(subject.legalEntityIdentifier.lei).toBe(northwind().lei);
  expect(subject.legalEntityIdentifier.isIllustrativeLei).toBe(true);
  expect(subject.legalForm).toBe(KYB.EntityLegalForm_LLC);
  const report = await validate(turtle, {
    expect: "org-identity-credential",
    focusNode: credential.value,
  });
  expect(report.conforms, JSON.stringify(report.violations)).toBe(true);
});

test("organisational-identity credential: a malformed LEI is rejected at the setter", () => {
  const credential = buildOrganisationalIdentityCredential(orgIdentityInit());
  expect(() => {
    credential.credentialSubject.legalEntityIdentifier.lei = "NOT-A-VALID-LEI";
  }).toThrow(/ISO 17442 lexical form/);
});

test("organisational-identity credential: a checksum-invalid LEI is rejected at the setter", () => {
  const credential = buildOrganisationalIdentityCredential(orgIdentityInit());
  const lei = northwind().lei;
  const corruptedChecksum = lei.slice(18) === "00" ? "01" : "00";
  expect(() => {
    credential.credentialSubject.legalEntityIdentifier.lei = `${lei.slice(0, 18)}${corruptedChecksum}`;
  }).toThrow(/checksum/);
});

test("organisational-identity credential: legalForm is restricted to the illustrative scheme", () => {
  const credential = buildOrganisationalIdentityCredential(orgIdentityInit());
  expect(() => {
    credential.credentialSubject.legalForm = "https://solid-kyb-vocab.vercel.app/kyb#NotAForm";
  }).toThrow(/legalForm/);
});

test("beneficial-ownership credential: four owners, bps sums to 10000, ZK budget enforced", async () => {
  const credential = buildBeneficialOwnershipCredential(beneficialOwnershipInit());
  const subject = credential.credentialSubject;
  const records = [...subject.ownershipRecords];
  expect(records).toHaveLength(4);
  const totalBps = records.reduce((sum, record) => sum + record.ownershipPercentageBps, 0);
  expect(totalBps).toBe(10000);
  const jordan = records.find((record) => record.owningEntity.ownerName === "Jordan Blake");
  expect(jordan?.ownershipPercentageBps).toBe(4200);
  expect(jordan?.ownedEntityIri).toBe(WEBID);
  const first = records[0];
  if (first === undefined) throw new Error("unreachable");
  expect(() => {
    first.ownershipPercentageBps = 10_001;
  }).toThrow(/4-digit ZK budget/);
  const turtle = await resourceToTurtle(credential);
  const report = await validate(turtle, {
    expect: "beneficial-ownership-credential",
    focusNode: credential.value,
  });
  expect(report.conforms, JSON.stringify(report.violations)).toBe(true);
});

test("beneficial-ownership credential: at least one ownership record is required", async () => {
  const credential = buildBeneficialOwnershipCredential({
    ...beneficialOwnershipInit(),
    ownershipRecords: [],
  });
  await expect(resourceToTurtle(credential)).rejects.toThrow(ShapeViolationError);
});

test("officer-authorization credential: managing officer, signing authority, read back", async () => {
  const credential = buildOfficerAuthorizationCredential(officerAuthorizationInit());
  const officer = credential.credentialSubject.authorizedOfficer;
  expect(officer.officerName).toBe("Jordan Blake");
  expect(officer.jobTitle).toBe(northwind().managingOfficerJobTitle);
  expect(officer.hasSigningAuthorityForIri).toBe(WEBID);
  expect(officer.isOfficerOfIri).toBe(WEBID);
  const turtle = await resourceToTurtle(credential);
  const report = await validate(turtle, {
    expect: "officer-authorization-credential",
    focusNode: credential.value,
  });
  expect(report.conforms, JSON.stringify(report.violations)).toBe(true);
});

test("cdd decision record: controlled status vocabulary + freshness trail", async () => {
  const record = buildCddDecisionRecord({
    iri: "https://bank-onboarding.example/decisions/northwind-1",
    decisionStatus: KYB.CddDecisionStatus_Opened,
    checkDate: NOW,
    checkedCredentials: [
      "https://northwind.pod.example/kyb/credentials/org-identity",
      "https://northwind.pod.example/kyb/credentials/beneficial-ownership",
    ],
  });
  await expect(resourceToTurtle(record)).resolves.toContain("CddDecisionRecord");
  expect(() => {
    record.decisionStatus = "https://solid-kyb-vocab.vercel.app/kyb#NotAStatus";
  }).toThrow(/decisionStatus/);
});

test("cdd decision record: at least one checked credential is required", async () => {
  const record = buildCddDecisionRecord({
    iri: "https://bank-onboarding.example/decisions/northwind-2",
    decisionStatus: KYB.CddDecisionStatus_PendingReview,
    checkDate: NOW,
    checkedCredentials: [],
  });
  await expect(resourceToTurtle(record)).rejects.toThrow(ShapeViolationError);
});

test("zk operand anchor: only ownershipPercentageBps is anchorable", async () => {
  const anchor = buildZkOperandAnchor({
    ...envelope("https://northwind.pod.example/kyb/credentials/anchors/ownership", {
      validUntil: undefined,
    }),
    field: KYB.ownershipPercentageBps,
    operandEnc: "0x07b66a6df9e52198d3d823f29c5030fd9721dafcf31b7a44da67a0f21d3710b",
  });
  await expect(resourceToTurtle(anchor)).resolves.toContain("operandEnc");
  expect(() => {
    anchor.credentialSubject.fieldIri = "https://solid-kyb-vocab.vercel.app/kyb#notAField";
  }).toThrow(/fieldIri/);
  expect(() => {
    anchor.credentialSubject.operandEnc = "0xNOTHEX";
  }).toThrow(/hex field element/);
});
