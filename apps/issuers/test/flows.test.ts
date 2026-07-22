/**
 * The pinned flow table: every flow signs claims matching its own kind
 * (never a cross-kind mismatch that `issueCredential` would refuse), the
 * beneficial-ownership flow's owners sum to 10,000 bps with a real
 * disclosed/undisclosed 25% boundary (design §7), and every flow's pod path
 * (credential + anchors) is unique.
 */
import { ZK_OWNERSHIP_THRESHOLD_BPS } from "@kyb/data-model";
import { expect, test } from "vitest";
import { ISSUER_FLOW_IDS } from "../lib/server/config";
import {
  ARRAY_COMMITMENT_ANCHOR_PATH,
  ISSUER_FLOWS,
  OWNER_ANCHORS,
  PERSONA,
} from "../lib/server/flows";

test("every flow's claims.kind matches its own kind", () => {
  for (const id of ISSUER_FLOW_IDS) {
    const definition = ISSUER_FLOWS[id];
    const claims = definition.claims();
    expect(claims.kind).toBe(definition.kind);
  }
});

test("only the beneficial-ownership flow mints ZK operand anchors", () => {
  const anchored = ISSUER_FLOW_IDS.filter((id) => ISSUER_FLOWS[id].mintsAnchors);
  expect(anchored).toEqual(["beneficial-ownership"]);
});

test("the four owners sum to exactly 10,000 bps with a real threshold boundary", () => {
  const total = PERSONA.owners.reduce((sum, owner) => sum + owner.ownershipPercentageBps, 0);
  expect(total).toBe(10_000);
  const above = PERSONA.owners.filter(
    (owner) => owner.ownershipPercentageBps >= ZK_OWNERSHIP_THRESHOLD_BPS,
  );
  const below = PERSONA.owners.filter(
    (owner) => owner.ownershipPercentageBps < ZK_OWNERSHIP_THRESHOLD_BPS,
  );
  expect(above.length).toBeGreaterThan(0);
  expect(below.length).toBeGreaterThan(0);
});

test("OWNER_ANCHORS has one entry per persona owner, each with a unique pod path", () => {
  expect(OWNER_ANCHORS).toHaveLength(PERSONA.owners.length);
  const paths = OWNER_ANCHORS.map((owner) => owner.path);
  expect(new Set(paths).size).toBe(paths.length);
  expect(paths).not.toContain(ARRAY_COMMITMENT_ANCHOR_PATH);
});

test("every flow's credential pod path is unique and distinct from every anchor path", () => {
  const credentialPaths = ISSUER_FLOW_IDS.map((id) => ISSUER_FLOWS[id].credentialPath);
  expect(new Set(credentialPaths).size).toBe(credentialPaths.length);
  const anchorPaths = [ARRAY_COMMITMENT_ANCHOR_PATH, ...OWNER_ANCHORS.map((owner) => owner.path)];
  for (const path of anchorPaths) expect(credentialPaths).not.toContain(path);
});

test("the beneficial-ownership flow's claims carry every owner's disclosed + bps values", () => {
  const claims = ISSUER_FLOWS["beneficial-ownership"].claims();
  if (claims.kind !== "beneficial-ownership-credential") throw new Error("unreachable");
  expect(claims.ownershipRecords).toHaveLength(PERSONA.owners.length);
  for (const [index, record] of claims.ownershipRecords.entries()) {
    const owner = PERSONA.owners[index];
    expect(owner).toBeDefined();
    expect(record.ownerName).toBe(owner?.name);
    expect(record.ownershipPercentageBps).toBe(owner?.ownershipPercentageBps);
  }
});

test("the officer-authorization flow's officer is the persona's managing officer", () => {
  const claims = ISSUER_FLOWS["officer-authorization"].claims();
  if (claims.kind !== "officer-authorization-credential") throw new Error("unreachable");
  expect(claims.officer.officerName).toBe(PERSONA.owners[0]?.name);
  expect(claims.officer.jobTitle).toBe(PERSONA.managingOfficerJobTitle);
});

test("the org-identity flow's claims carry the persona's illustrative LEI", () => {
  const claims = ISSUER_FLOWS["org-identity"].claims();
  if (claims.kind !== "org-identity-credential") throw new Error("unreachable");
  expect(claims.lei).toBe(PERSONA.lei);
  expect(claims.businessName).toBe(PERSONA.businessName);
});
