/**
 * Seed-tooling: `mintOperandAnchors` equivalent (design §4). Real coverage -
 * mints genuine eddsa-rdfc-2022-signed anchor VCs for both the Tier A
 * per-owner field (given a precomputed operandEnc, mirroring the native
 * bridge's output) and the Tier B array-commitment field (computed here in
 * pure JS, no native bridge needed), and verifies each through the real
 * verifier + SHACL + hosted Bitstring status list.
 */

import { expect, test } from "vitest";
import { KYB } from "@kyb/data-model";
import {
  mintArrayCommitmentAnchor,
  mintOwnershipBpsAnchor,
  mintZkOperandAnchor,
} from "../src/seed-tooling/index.ts";
import { ownershipArrayCommitment, verifyCredential } from "../src/index.ts";
import {
  BACKDATED_VALIDITY,
  hostedStatusList,
  ISSUER,
  issuerKey,
  NOW,
  resolveIssuerKey,
  stubHost,
  SUBJECT,
} from "./support.ts";
import { encOf } from "./zk-support.ts";

test("mintOwnershipBpsAnchor mints a genuine, verifiable Tier A anchor", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const anchor = await mintOwnershipBpsAnchor({
    credentialId: "https://northwind.pod.example/kyb/credentials/anchors/jordan-bps",
    issuer: ISSUER,
    subject: SUBJECT,
    validity: BACKDATED_VALIDITY,
    status: list.entry(51),
    key: await issuerKey(),
    operandEnc: encOf(2860),
  });
  const outcome = await verifyCredential(anchor.body, {
    expectShape: "zk-operand-anchor",
    now: NOW,
    resolveKey: resolveIssuerKey,
    statusFetch: host.fetch,
  });
  expect(outcome.errors).toEqual([]);
  expect(outcome.verified).toBe(true);
  expect(anchor.body).toContain(KYB.ownershipPercentageBps);
});

test("mintArrayCommitmentAnchor computes the commitment (pure JS) and mints a genuine anchor", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const owners = [4200, 2800, 1800, 1200];
  const { anchor, arrayCommitment } = await mintArrayCommitmentAnchor({
    credentialId: "https://northwind.pod.example/kyb/credentials/anchors/owner-array",
    issuer: ISSUER,
    subject: SUBJECT,
    validity: BACKDATED_VALIDITY,
    status: list.entry(52),
    key: await issuerKey(),
    bps: owners,
  });
  expect(arrayCommitment).toBe(await ownershipArrayCommitment(owners));
  const outcome = await verifyCredential(anchor.body, {
    expectShape: "zk-operand-anchor",
    now: NOW,
    resolveKey: resolveIssuerKey,
    statusFetch: host.fetch,
  });
  expect(outcome.errors).toEqual([]);
  expect(outcome.verified).toBe(true);
  expect(anchor.body).toContain(KYB.beneficialOwnershipArrayCommitment);
  expect(anchor.body).toContain(arrayCommitment);
});

test("ownershipArrayCommitment is deterministic and order-sensitive", async () => {
  const a = await ownershipArrayCommitment([4200, 2800, 1800, 1200]);
  const b = await ownershipArrayCommitment([4200, 2800, 1800, 1200]);
  const reordered = await ownershipArrayCommitment([2800, 4200, 1800, 1200]);
  expect(a).toBe(b);
  expect(a).not.toBe(reordered);
});

test("mintZkOperandAnchor refuses a non-anchorable field at the build-time gate", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  await expect(
    mintZkOperandAnchor({
      credentialId: "https://northwind.pod.example/kyb/credentials/anchors/bad",
      issuer: ISSUER,
      subject: SUBJECT,
      validity: BACKDATED_VALIDITY,
      status: list.entry(53),
      key: await issuerKey(),
      field:
        "https://spec.edmcouncil.org/fibo/ontology/BE/LegalEntities/LEIEntities/LegalEntityIdentifier",
      operandEnc: encOf(2860),
    }),
  ).rejects.toThrow(RangeError);
});
