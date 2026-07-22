import { onboardingService } from "../../../../lib/server/service";

/**
 * Design §4: "the bank issues a single-use nonce". The AUTHENTICATED
 * business mints this bank's Tier A + Tier B ZK challenge nonces here, then
 * proves against them and presents the proofs to `POST /api/kyb/decision`.
 */
export async function POST(request: Request): Promise<Response> {
  return onboardingService().challenge(request);
}
