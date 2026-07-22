import { devSeedAllowed, devSeedTarget } from "../../../../../lib/server/dev-seed";
import {
  type ZkChallenge,
  ZkServiceError,
  proveAndVerify,
} from "../../../../../lib/server/zk-service";

function isChallengePair(value: unknown): value is { sessionKey: string; nonce: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).sessionKey === "string" &&
    typeof (value as Record<string, unknown>).nonce === "string"
  );
}

/**
 * `POST { tierA: {sessionKey, nonce}, tierB: {sessionKey, nonce} }` — prove the scene-3
 * Tier A per-owner threshold and Tier B completeness statements over the dev-seeded pod's
 * verified credentials, then immediately verify the proofs produced. Dev-gated (mirrors
 * `/api/dev/seed`): refuses in production and when no seed target is configured — never
 * picks a default pod. See `../../../../../lib/server/zk-service.ts`'s header for the "this
 * rail also stands in as the verifier" honesty note (no live bank rail exists yet in this
 * repo to VP-POST to).
 */
export async function POST(request: Request): Promise<Response> {
  if (!devSeedAllowed()) {
    return Response.json(
      { simulated: true, error: "unavailable", detail: "disabled in production" },
      { status: 404 },
    );
  }
  const target = devSeedTarget();
  if (target === undefined) {
    return Response.json(
      {
        simulated: true,
        error: "not_configured",
        detail: "set KYB_SEED_POD_URL and KYB_SEED_WEBID (see .env.example)",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { simulated: true, error: "malformed_request", detail: "body must be JSON" },
      { status: 400 },
    );
  }
  if (typeof body !== "object" || body === null) {
    return Response.json(
      { simulated: true, error: "malformed_request", detail: "body must be a JSON object" },
      { status: 400 },
    );
  }
  const { tierA, tierB } = body as Record<string, unknown>;
  if (!isChallengePair(tierA) || !isChallengePair(tierB)) {
    return Response.json(
      {
        simulated: true,
        error: "malformed_request",
        detail: "body.tierA and body.tierB must each be { sessionKey, nonce }",
      },
      { status: 400 },
    );
  }
  const challenge: ZkChallenge = { tierA, tierB };

  const podBase = target.podUrl.endsWith("/") ? target.podUrl : `${target.podUrl}/`;
  try {
    const result = await proveAndVerify({
      podBase,
      webid: target.webid,
      challenge,
      now: new Date(),
    });
    return Response.json({
      simulated: true,
      tierA: {
        verified: result.tierA.verification.verified,
        errors: result.tierA.verification.errors,
        proveMs: result.tierA.proveMs,
      },
      tierB: {
        verified: result.tierB.verification.verified,
        errors: result.tierB.verification.errors,
        proveMs: result.tierB.proveMs,
      },
    });
  } catch (error) {
    if (error instanceof ZkServiceError) {
      return Response.json(
        { simulated: true, error: "zk_prove_failed", detail: error.message },
        { status: error.status },
      );
    }
    return Response.json({ simulated: true, error: "internal_error" }, { status: 500 });
  }
}
