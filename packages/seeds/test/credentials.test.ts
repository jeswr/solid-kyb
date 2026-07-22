/**
 * Determinism + persona-pinning gates for the scripted credential layer (design §7): the
 * generated claims never read the clock, the four owners' basis points sum to exactly
 * 10,000 and split 2-above/2-below the 2,500-bps scene-3 threshold, and every credential
 * carries a pod-root-relative path.
 */
import { ZK_OWNERSHIP_THRESHOLD_BPS } from "@kyb/data-model";
import { expect, test } from "vitest";
import {
  CREDENTIAL_POD_PATHS,
  northwindLogistics,
  scriptedCredentialSeeds,
} from "../credentials.ts";

const NOW = new Date("2026-07-22T12:00:00.000Z");

test("northwindLogistics pins the design §7 persona", () => {
  const persona = northwindLogistics();
  expect(persona.businessName).toBe("Northwind Logistics LLC");
  expect(persona.owners).toHaveLength(4);
  const totalBps = persona.owners.reduce((sum, owner) => sum + owner.ownershipPercentageBps, 0);
  expect(totalBps).toBe(10_000);
  const above = persona.owners.filter(
    (owner) => owner.ownershipPercentageBps >= ZK_OWNERSHIP_THRESHOLD_BPS,
  );
  const below = persona.owners.filter(
    (owner) => owner.ownershipPercentageBps < ZK_OWNERSHIP_THRESHOLD_BPS,
  );
  expect(above.map((owner) => owner.name)).toEqual(["Jordan Blake", "Priya Nandakumar"]);
  expect(below.map((owner) => owner.name)).toEqual(["Marcus Webb", "Dana Reyes"]);
});

test("scriptedCredentialSeeds is deterministic (same now, same output)", () => {
  const persona = northwindLogistics();
  const first = scriptedCredentialSeeds(persona, NOW);
  const second = scriptedCredentialSeeds(persona, NOW);
  expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
});

test("every scripted credential targets a pod-root-relative CREDENTIAL_POD_PATHS entry", () => {
  const persona = northwindLogistics();
  const seeds = scriptedCredentialSeeds(persona, NOW);
  expect(seeds).toHaveLength(3);
  const paths = new Set(Object.values(CREDENTIAL_POD_PATHS));
  for (const spec of seeds) {
    expect(spec.path.startsWith("/")).toBe(true);
    expect(paths.has(spec.path)).toBe(true);
    expect(spec.validFrom.getTime()).toBeLessThan(spec.validUntil.getTime());
  }
  // No two credentials share a status-list index within the same issuer role.
  const byIssuer = new Map<string, Set<number>>();
  for (const spec of seeds) {
    const seen = byIssuer.get(spec.issuerRole) ?? new Set<number>();
    expect(seen.has(spec.statusIndex)).toBe(false);
    seen.add(spec.statusIndex);
    byIssuer.set(spec.issuerRole, seen);
  }
});
