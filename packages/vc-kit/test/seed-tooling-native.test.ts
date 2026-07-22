/**
 * INTEGRATION coverage of the real native bridge: builds and runs the
 * `scripts/sparq-helper` Rust binary against a local sparq checkout and
 * asserts its outputs are byte-identical to the committed fixtures (which
 * were captured the same way by the sibling mortgage/lending showcases —
 * fixtures/PROVENANCE.json — this package's own fixtures are copies of
 * theirs, same checkout commit, same toolchain, same `filter_int_d4`
 * circuit family).
 *
 * Gated: needs `SPARQ_CHECKOUT` + cargo on PATH. Skipped otherwise (this
 * build environment has neither — see src/seed-tooling/native.ts's module
 * header for the honest scope note).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SparqEncodeHelper } from "../src/seed-tooling/index.ts";

const SPARQ_CHECKOUT = process.env.SPARQ_CHECKOUT;

function cargoAvailable(): boolean {
  try {
    execFileSync("cargo", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const enabled = SPARQ_CHECKOUT !== undefined && SPARQ_CHECKOUT !== "" && cargoAvailable();
// First build compiles the sparq crates - allow plenty.
const NATIVE_TIMEOUT = 15 * 60 * 1000;

describe.skipIf(!enabled)("SparqEncodeHelper (native, gated on SPARQ_CHECKOUT)", () => {
  it(
    "reproduces the committed operand encodings",
    async () => {
      const helper = new SparqEncodeHelper({ sparqCheckout: SPARQ_CHECKOUT ?? "" });
      const committed = JSON.parse(
        readFileSync(join(import.meta.dirname, "fixtures", "operand-enc.json"), "utf8"),
      ) as { encodings: Record<string, string> };
      const values = Object.keys(committed.encodings).map(Number);
      const result = await helper.run({ encodeInts: values });
      expect(result.encodings).toEqual(committed.encodings);
    },
    NATIVE_TIMEOUT,
  );
});

describe("SparqEncodeHelper (constructor guards, always run)", () => {
  it("refuses a non-existent checkout path", () => {
    expect(() => new SparqEncodeHelper({ sparqCheckout: "/does/not/exist" })).toThrow(
      /sparqCheckout does not exist/,
    );
  });
});
