import { issuerService } from "../../../lib/server/service";

/**
 * Scene 1 ("fill the vault"): POST `{ flow }` signs one of the three issuer
 * flows' credentials — plus, for beneficial-ownership, its ZK operand
 * anchors — into the AUTHENTICATED caller's Data Vault pod. See
 * `lib/server/issuer-rail.ts` for the full fail-closed contract (real
 * DPoP-bound Solid-OIDC auth, the bidirectional pod binding, no signing
 * oracle, no anonymous pod-IO fallback, and the honest SPARQ_CHECKOUT gating
 * on Tier A operand anchors).
 */
export async function POST(request: Request): Promise<Response> {
  return issuerService().issue(request);
}
