/**
 * The vault's dev-gated "Mode-1" seed: browser-triggered seeding of Northwind Logistics
 * LLC's real signed KYB-credential pod (`./kyb-issuance.ts`). This scaffold ships no
 * in-browser WASM pod runtime, so this is a Next.js Route Handler (Node runtime,
 * server-side) that a client-side "Seed demo persona" button calls — the seeding is
 * BROWSER-TRIGGERED even though the vc-kit issuance itself runs server-side (it needs
 * `node:crypto`/`node:buffer`, never bundled to the client).
 *
 * Dev/demo only: fails closed like every other pod-facing surface in this repo (see
 * `./config.ts`'s pod-guard rail) — refuses outside development and refuses when the seed
 * target isn't configured, never picks a default pod to write into.
 */
import { type SeededKybPod, seedNorthwindPod } from "./kyb-issuance";

const PREFIX = "KYB";

export class DevSeedUnavailableError extends Error {}
export class DevSeedUnconfiguredError extends Error {}

/** Whether this dev-only surface may run at all — production always refuses. */
export function devSeedAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** The configured seed target (`KYB_SEED_POD_URL` / `KYB_SEED_WEBID`), or `undefined` when
 * either is unset — never a fabricated default pod. */
export function devSeedTarget(): { podUrl: string; webid: string } | undefined {
  const podUrl = process.env[`${PREFIX}_SEED_POD_URL`];
  const webid = process.env[`${PREFIX}_SEED_WEBID`];
  if (podUrl === undefined || webid === undefined || podUrl === "" || webid === "") {
    return undefined;
  }
  return { podUrl, webid };
}

/** Seed the demo persona pod named by env. */
export async function runDevSeed(): Promise<SeededKybPod> {
  if (!devSeedAllowed()) {
    throw new DevSeedUnavailableError("the dev seed route is disabled in production");
  }
  const target = devSeedTarget();
  if (target === undefined) {
    throw new DevSeedUnconfiguredError(
      `set ${PREFIX}_SEED_POD_URL and ${PREFIX}_SEED_WEBID (see .env.example) — a dev seed ` +
        "target is never picked automatically",
    );
  }
  const podBase = target.podUrl.endsWith("/") ? target.podUrl : `${target.podUrl}/`;
  return seedNorthwindPod({ podBase, webid: target.webid, now: new Date() });
}
