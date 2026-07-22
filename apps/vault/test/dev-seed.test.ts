/**
 * The vault's dev-seed round trip, against a REAL `@jeswr/solid-server` pod: seed Northwind
 * Logistics LLC's three KYB credentials + two ZK operand anchors
 * (`../lib/server/kyb-issuance.ts`), then verify-on-view every credential
 * (`../lib/server/credential-summary.ts`) — the FULL fail-closed `verifyCredential` chain,
 * never mocked.
 */
import { startSolidServer, type SolidTestServer } from "@kyb/test-kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readCredentialSummaries } from "../lib/server/credential-summary";
import { seedNorthwindPod } from "../lib/server/kyb-issuance";

const NOW = new Date("2026-07-22T12:00:00Z");

let pods: SolidTestServer;
let podBase: string;
let webid: string;

beforeAll(async () => {
  pods = await startSolidServer({});
  const primary = pods.accounts[0];
  if (primary === undefined) throw new Error("harness did not provision an owner");
  podBase = `${primary.baseUrl}/`;
  webid = primary.webid;
  await seedNorthwindPod({ podBase, webid, now: NOW });
}, 60_000);

afterAll(async () => {
  await pods?.stop();
});

describe("seedNorthwindPod", () => {
  it("writes three genuinely signed, verify-on-view credentials", async () => {
    const summaries = await readCredentialSummaries({ podBase, now: NOW });
    expect(summaries).toHaveLength(3);
    for (const summary of summaries) {
      expect(summary.errors, `${summary.id}: ${summary.errors.join("; ")}`).toEqual([]);
      expect(summary.status).toBe("valid");
    }
    expect(summaries.map((summary) => summary.id).sort()).toEqual([
      "beneficialOwnership",
      "officerAuthorization",
      "orgIdentity",
    ]);
  });

  it("fails closed against a tampered credential (a flipped byte breaks the signature)", async () => {
    const iri = `${podBase}kyb/credentials/org-identity`;
    const original = await (await fetch(iri)).text();
    const tampered = original.replace('"Northwind Logistics LLC"', '"Mallory Holdings LLC"');
    expect(tampered).not.toBe(original);
    await fetch(iri, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: tampered,
    });
    try {
      const summaries = await readCredentialSummaries({ podBase, now: NOW });
      const orgIdentity = summaries.find((summary) => summary.id === "orgIdentity");
      expect(orgIdentity?.status).not.toBe("valid");
      expect(orgIdentity?.errors.length).toBeGreaterThan(0);
    } finally {
      // Restore for any later test in this file.
      await fetch(iri, {
        method: "PUT",
        headers: { "content-type": "text/turtle" },
        body: original,
      });
    }
  });
});
