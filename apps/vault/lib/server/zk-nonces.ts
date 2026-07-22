/**
 * A single-use challenge-nonce store for the scene-3 ZK prove-in-browser rail
 * (`@kyb/vc-kit`'s {@link ZkNonceConsumer} contract). Process-local — fine for this dev/demo
 * scaffold's single instance; a multi-instance deploy needs a shared store (same seam
 * family as the mortgage/lending showcases' own documented residual for their DPoP jti
 * replay store).
 */
import type { ZkNonceConsumer } from "@kyb/vc-kit";
import { randomUUID } from "node:crypto";

const NONCE_TTL_MS = 5 * 60 * 1000;

interface LiveChallenge {
  readonly nonce: string;
  readonly expiresAt: number;
}

const live = new Map<string, LiveChallenge>();

function sweep(now: number): void {
  for (const [sessionKey, challenge] of live) {
    if (challenge.expiresAt <= now) live.delete(sessionKey);
  }
}

/** Mint a fresh single-use challenge for a fresh session key. */
export function mintChallenge(now: () => Date = () => new Date()): {
  sessionKey: string;
  nonce: string;
} {
  const instant = now().getTime();
  sweep(instant);
  const sessionKey = randomUUID();
  const nonce = randomUUID();
  live.set(sessionKey, { nonce, expiresAt: instant + NONCE_TTL_MS });
  return { sessionKey, nonce };
}

/** The shared {@link ZkNonceConsumer}: burns the challenge on first use, regardless of
 * outcome — a presenter gets exactly one shot per nonce. */
export const nonceConsumer: ZkNonceConsumer = {
  consume(sessionKey: string, nonce: string): boolean {
    sweep(Date.now());
    const challenge = live.get(sessionKey);
    live.delete(sessionKey);
    return challenge !== undefined && challenge.nonce === nonce;
  },
};
