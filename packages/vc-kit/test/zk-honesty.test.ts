/**
 * Copy-drift guard for the MANDATORY ZK honesty panel (design §4/§8.1) - a
 * ZK surface without this content must not ship, so the load-bearing
 * phrases are pinned here.
 */

import { describe, expect, it } from "vitest";
import {
  PINNED_BB_JS_VERSION,
  PINNED_NARGO_VERSION,
  PINNED_NOIR_JS_VERSION,
  ZK_HONESTY,
  ZK_HONESTY_ITEMS,
  ZK_TOOLCHAIN,
} from "../src/index.ts";

describe("ZK_HONESTY", () => {
  it("declares the pre-decision-only scope", () => {
    const item = ZK_HONESTY_ITEMS.find((entry) => entry.id === "pre-decision-scope");
    expect(item).toBeDefined();
    expect(item?.title).toContain("PRE-DECISION");
    expect(item?.body).toMatch(/disclosed/i);
  });

  it("states research-grade / externally-unaudited honestly", () => {
    const item = ZK_HONESTY_ITEMS.find((entry) => entry.id === "research-grade");
    expect(item?.body).toContain("research-grade");
    expect(item?.body).toContain("audit");
    expect(ZK_HONESTY.headline).toContain("research-grade");
  });

  it("documents the mandatory operand-anchor binding", () => {
    const item = ZK_HONESTY_ITEMS.find((entry) => entry.id === "operand-anchor-binding");
    expect(item?.body).toContain("anchor");
    expect(item?.body).toContain("single-use challenge");
  });

  it("documents the Tier B bespoke-circuit scope-down honestly", () => {
    const item = ZK_HONESTY_ITEMS.find((entry) => entry.id === "tier-b-completeness");
    expect(item?.title).toContain("bespoke");
    expect(item?.body).toContain("LIVE");
    // Never overclaims composed sparq family membership.
    expect(item?.body).toContain("scope-down");
  });

  it("documents the digit-count leak and low-entropy enumerability - never overclaims", () => {
    const leak = ZK_HONESTY_ITEMS.find((entry) => entry.id === "digit-budget-leak");
    const enumerable = ZK_HONESTY_ITEMS.find((entry) => entry.id === "low-entropy-enumeration");
    expect(leak?.body).toContain("digit count");
    expect(enumerable?.body).toContain("not disclosed and not forgeable");
    expect(enumerable?.body).toContain("never 'cannot possibly be learned'");
  });

  it("pins the toolchain versions exactly", () => {
    expect(ZK_TOOLCHAIN.noirJs).toBe(`@noir-lang/noir_js@${PINNED_NOIR_JS_VERSION}`);
    expect(ZK_TOOLCHAIN.bbJs).toBe(`@aztec/bb.js@${PINNED_BB_JS_VERSION}`);
    expect(ZK_TOOLCHAIN.nargo).toBe(`nargo ${PINNED_NARGO_VERSION}`);
    expect(ZK_TOOLCHAIN.verifierTarget).toBe("evm");
  });

  it("every item has a stable id, title and non-empty body", () => {
    const ids = new Set<string>();
    for (const item of ZK_HONESTY_ITEMS) {
      expect(item.id.length).toBeGreaterThan(0);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.body.length).toBeGreaterThan(0);
      expect(ids.has(item.id)).toBe(false);
      ids.add(item.id);
    }
  });
});
