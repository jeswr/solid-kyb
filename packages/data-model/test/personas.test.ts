/**
 * Persona gates: the Northwind Logistics LLC fixture is deterministic (same
 * now + seed => byte-identical Turtle), its four beneficial owners sum to
 * exactly 10,000 bps and straddle the scene-3 25% (2,500 bps) threshold
 * (design §7's pinning promise), every resource validates root-bound against
 * its shape, and the fictional LEI is checksum-valid and clearly marked.
 */
import { expect, test } from "vitest";
import {
  isValidIso17442Checksum,
  PERSONA_VALUES,
  personas,
  RESOURCE_POD_PATHS,
  validate,
  ZK_OWNERSHIP_THRESHOLD_BPS,
} from "../src/index.ts";
import { NOW } from "./support.ts";

test("persona values: four owners sum to 10000 bps and straddle the 25% threshold", () => {
  const northwind = PERSONA_VALUES[0];
  expect(northwind).toBeDefined();
  if (northwind === undefined) return;
  expect(northwind.businessName).toBe("Northwind Logistics LLC");
  expect(northwind.owners).toHaveLength(4);
  const totalBps = northwind.owners.reduce((sum, owner) => sum + owner.ownershipPercentageBps, 0);
  expect(totalBps).toBe(10000);
  const above = northwind.owners.filter(
    (owner) => owner.ownershipPercentageBps >= ZK_OWNERSHIP_THRESHOLD_BPS,
  );
  const below = northwind.owners.filter(
    (owner) => owner.ownershipPercentageBps < ZK_OWNERSHIP_THRESHOLD_BPS,
  );
  expect(above.map((owner) => owner.name).sort()).toEqual(["Jordan Blake", "Priya Nandakumar"]);
  expect(below.map((owner) => owner.name).sort()).toEqual(["Dana Reyes", "Marcus Webb"]);
});

test("the persona's LEI is ISO 17442-shaped and checksum-valid, never a real accredited LOU", () => {
  const northwind = PERSONA_VALUES[0];
  if (northwind === undefined) throw new Error("persona values missing");
  expect(northwind.lei).toMatch(/^9999[0-9A-Z]{14}[0-9]{2}$/);
  expect(isValidIso17442Checksum(northwind.lei)).toBe(true);
});

test("disclosed percentage and ZK bps agree for every owner", () => {
  const northwind = PERSONA_VALUES[0];
  if (northwind === undefined) throw new Error("persona values missing");
  for (const owner of northwind.owners) {
    expect(owner.ownershipPercentageBps).toBe(Math.round(owner.ownershipPercentage * 100));
  }
});

test("personas() is deterministic and every resource validates root-bound", async () => {
  const [first, second] = await Promise.all([personas({ now: NOW }), personas({ now: NOW })]);
  expect(first).toHaveLength(1);
  const persona = first?.[0];
  const rerun = second?.[0];
  if (persona === undefined || rerun === undefined) throw new Error("persona missing");

  expect(persona.resources.map((resource) => resource.turtle)).toEqual(
    rerun.resources.map((resource) => resource.turtle),
  );
  expect(persona.resources).toHaveLength(Object.keys(RESOURCE_POD_PATHS).length);

  for (const resource of persona.resources) {
    expect(resource.iri).toBe(`${persona.podBase}${resource.path.slice(1)}`);
    const report = await validate(resource.turtle, {
      expect: resource.kind,
      focusNode: resource.focusNode,
    });
    expect(report.conforms, `${resource.kind}: ${JSON.stringify(report.violations)}`).toBe(true);
  }
});

test("credentialSubject follows the webId override (holder binding)", async () => {
  const webId = "https://vault.example/northwind#business";
  const [persona] = await personas({ now: NOW, webIds: { "northwind-logistics": webId } });
  if (persona === undefined) throw new Error("persona missing");
  expect(persona.webId).toBe(webId);
  for (const resource of persona.resources) {
    expect(resource.turtle).toContain(webId);
  }
});

test("every persona resource shares the same holder-bound credentialSubject (the business's own WebID)", async () => {
  const [persona] = await personas({ now: NOW });
  if (persona === undefined) throw new Error("persona missing");
  for (const resource of persona.resources) {
    // The resource's own pod IRI (focus node) is distinct from the
    // credentialSubject it carries — every credential is holder-bound to
    // the SAME business WebID, never to its own resource IRI.
    expect(resource.focusNode).toBe(resource.iri);
    expect(resource.turtle).toContain(persona.webId);
  }
});
