import { onboardingService } from "../../../../lib/server/service";

/**
 * Scene 2 ("onboard without re-submitting"): reads the org-identity,
 * beneficial-ownership, and officer-authorization credentials from the
 * business's pod, verifies the presented Tier A/Tier B ZK proofs against
 * their issuer-anchored operands, and returns an APPROVE/DECLINE KYB/CDD
 * decision. See `lib/server/onboarding-rail.ts` for the full fail-closed
 * contract.
 */
export async function POST(request: Request): Promise<Response> {
  return onboardingService().decision(request);
}
