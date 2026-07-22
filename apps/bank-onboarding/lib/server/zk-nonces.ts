/**
 * The bank's single-use ZK challenge-nonce store (`@kyb/vc-kit`'s
 * `ZkNonceConsumer` contract) — the bank-minted challenge design §4 requires
 * ("the bank issues a single-use nonce ... the bank verifies against the
 * issuer-anchored operand"). Process-local — fine for this dev/demo
 * scaffold's single instance; a multi-instance deploy needs a shared store
 * (same documented residual `apps/vault`'s own nonce store carries).
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

export interface ZkChallengePair {
  readonly sessionKey: string;
  readonly nonce: string;
}

/** One challenge PER TIER (each tier's verify call burns its own nonce, so sharing one
 * across both tiers would fail the second verify). */
export interface ZkChallenge {
  readonly tierA: ZkChallengePair;
  readonly tierB: ZkChallengePair;
}

export function issueChallenge(now: () => Date = () => new Date()): ZkChallenge {
  return { tierA: mintChallenge(now), tierB: mintChallenge(now) };
}
