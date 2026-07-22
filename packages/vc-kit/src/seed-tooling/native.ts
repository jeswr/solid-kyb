/**
 * The Node bridge into sparq's NATIVE `encode_int_literal` tooling (design §4
 * Tier A operand anchors). `kyb:ownershipPercentageBps`'s Tier A anchor needs
 * the EXACT sparq term encoding the `filter_int_d4` circuit checks
 * in-circuit; that encoding is produced by sparq's own crates
 * (`sparq-zk`/`sparq-zk-compose`) - never reimplemented in JS (decisions
 * 0004/0012, mirrored from the mortgage/lending showcases' own seed
 * tooling). This module only locates a local sparq checkout, builds/spawns
 * `scripts/sparq-helper`, and marshals JSON.
 *
 * SCOPE NOTE: unlike the mortgage/lending showcases' native bridge, this
 * module does NOT need the Poseidon2/Schnorr dual-sign or Tier B composite
 * (join/revoke/hidden-issuer) capabilities - this package's OWN Tier B
 * circuit (`kyb_completeness_scan_n8`) anchors its operand via a plain
 * Blake3 commitment computed entirely in JS (`zk/commitment.ts`), needing no
 * native bridge at all. Only Tier A's `ownershipPercentageBps` anchor needs
 * this bridge.
 *
 * Node-only (`node:child_process` etc.) - exported via the package's
 * `./seed-tooling` entry, NEVER from the browser-safe root export.
 *
 * NOT BUILT OR RUN IN THIS ENVIRONMENT: this sandbox has no local sparq
 * checkout (no `SPARQ_CHECKOUT`), so `scripts/sparq-helper` here is
 * committed source only, unbuilt and untested against a real checkout - the
 * same honest gating the mortgage/lending showcases already use for their
 * own native bridges (`seed-tooling-native.test.ts`, skipped without a
 * checkout). Minting REAL Tier A operand anchors for the Northwind persona's
 * actual ownershipPercentageBps values is deferred to the seeder phase, once
 * SPARQ_CHECKOUT access is available.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Thrown for every native-toolchain failure (missing checkout, build, run). */
export class SeedToolingError extends Error {
  override readonly name: string = "SeedToolingError";
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** The job document the helper reads from stdin (mirrors `scripts/sparq-helper/src/main.rs`). */
export interface SparqEncodeJob {
  /** `xsd:integer` values to encode (`operand_enc` for `kyb:ownershipPercentageBps`). */
  readonly encodeInts: readonly number[];
}

/** The result document the helper writes to stdout. */
export interface SparqEncodeResult {
  /** value (decimal string) -> operand_enc (0x hex), per `job.encodeInts`. */
  readonly encodings: Readonly<Record<string, string>>;
}

/**
 * The seam tests stub against: anything that can answer a
 * {@link SparqEncodeJob}. Production/capture use {@link SparqEncodeHelper};
 * unit tests inject canned results captured from the real helper (fixtures
 * with provenance) or reuse genuine captures from the sibling mortgage/
 * lending repos' own `filter_int_d4` fixtures (same circuit family, same
 * pinned checkout commit).
 */
export interface SparqNativeBridge {
  run(job: SparqEncodeJob): Promise<SparqEncodeResult>;
}

export interface SparqEncodeHelperOptions {
  /** Path to a local sparq checkout (jeswr/sparq). REQUIRED - no default. */
  readonly sparqCheckout: string;
  /** Override the helper crate directory (defaults to ../../scripts/sparq-helper). */
  readonly helperDir?: string;
}

const HELPER_BINARY = join("target", "release", "kyb-sparq-seed-helper");

/**
 * Builds and runs the `scripts/sparq-helper` binary against a local sparq
 * checkout. The checkout is wired in via the `.sparq` symlink (the committed
 * Cargo.toml path-deps resolve through it), so the checkout path never
 * appears in committed files.
 */
export class SparqEncodeHelper implements SparqNativeBridge {
  readonly #checkout: string;
  readonly #helperDir: string;
  #built: Promise<void> | undefined;

  constructor(options: SparqEncodeHelperOptions) {
    if (!options.sparqCheckout || !existsSync(options.sparqCheckout)) {
      throw new SeedToolingError(
        "NO_SPARQ_CHECKOUT",
        `sparqCheckout does not exist: ${String(options.sparqCheckout)} - clone jeswr/sparq and pass its path (SPARQ_CHECKOUT)`,
      );
    }
    this.#checkout = options.sparqCheckout;
    this.#helperDir =
      options.helperDir ?? fileURLToPath(new URL("../../scripts/sparq-helper", import.meta.url));
  }

  /** The sparq checkout commit (for PROVENANCE records). */
  async sparqCommit(): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-C", this.#checkout, "rev-parse", "HEAD"]);
    return stdout.trim();
  }

  /** Symlink the checkout + `cargo build --release` (idempotent, memoised). */
  build(): Promise<void> {
    this.#built ??= this.#doBuild().catch((error: unknown) => {
      this.#built = undefined;
      throw error;
    });
    return this.#built;
  }

  async #doBuild(): Promise<void> {
    const link = join(this.#helperDir, ".sparq");
    await rm(link, { force: true });
    await symlink(this.#checkout, link, "dir");
    try {
      await execFileAsync("cargo", ["build", "--release"], {
        cwd: this.#helperDir,
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (error) {
      throw new SeedToolingError(
        "HELPER_BUILD_FAILED",
        `cargo build of scripts/sparq-helper failed - is the Rust toolchain installed and the sparq checkout intact? ${(error as Error).message}`,
      );
    }
  }

  async run(job: SparqEncodeJob): Promise<SparqEncodeResult> {
    await this.build();
    const binary = join(this.#helperDir, HELPER_BINARY);
    const child = execFile(binary, [], { maxBuffer: 256 * 1024 * 1024 });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
    child.stdin?.end(JSON.stringify({ encodeInts: job.encodeInts }));
    const code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status) => resolve(status ?? 1));
    });
    if (code !== 0) {
      throw new SeedToolingError(
        "HELPER_FAILED",
        `kyb-sparq-seed-helper exited ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`,
      );
    }
    return JSON.parse(Buffer.concat(stdout).toString("utf8")) as SparqEncodeResult;
  }
}

/**
 * Resolve a bridge from `SPARQ_CHECKOUT`, or throw fail-closed. Callers that
 * want to skip gracefully in an environment without a checkout should check
 * `process.env.SPARQ_CHECKOUT` themselves (see this package's own
 * `seed-tooling-native.test.ts` for the pattern) rather than relying on this
 * throwing being caught silently.
 */
export function sparqEncodeHelperFromEnv(): SparqEncodeHelper {
  const sparqCheckout = process.env.SPARQ_CHECKOUT;
  if (sparqCheckout === undefined || sparqCheckout.length === 0) {
    throw new SeedToolingError(
      "NO_SPARQ_CHECKOUT",
      "SPARQ_CHECKOUT is not set - minting a genuine Tier A operand anchor for a NEW " +
        "ownershipPercentageBps value requires a local jeswr/sparq checkout (not available in " +
        "this build environment); reuse a genuine captured filter_int_d4 fixture instead, or " +
        "run this against a checkout to mint fresh anchors for the seeder phase.",
    );
  }
  return new SparqEncodeHelper({ sparqCheckout });
}
