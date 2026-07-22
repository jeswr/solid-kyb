import { devSeedAllowed } from "../../../../../lib/server/dev-seed";
import { issueChallenge } from "../../../../../lib/server/zk-service";

/**
 * Mint independent single-use challenge nonces for the scene-3 Tier A + Tier B proofs
 * (dev-gated the same way as `/api/dev/seed`; see `../prove/route.ts`'s header for the
 * "who verifies" honesty note).
 */
export async function POST(): Promise<Response> {
  if (!devSeedAllowed()) {
    return Response.json(
      { simulated: true, error: "unavailable", detail: "disabled in production" },
      { status: 404 },
    );
  }
  const challenge = issueChallenge();
  return Response.json({ simulated: true, ...challenge });
}
