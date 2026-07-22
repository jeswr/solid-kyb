import { getVaultGrantService } from "../../../../lib/server/vault-service-instance";

/**
 * `POST { party, resource, action }` — grant or revoke one bank's read access to one
 * catalogue credential. Real auth: anonymous ⇒ 401, `pod`/`webid` overrides (query or body,
 * any depth) ⇒ 400, the party's WebID is OPERATOR-PINNED env config (never
 * request-supplied), revocation is immutable, repeats are loud 409 no-ops.
 */
export async function POST(request: Request): Promise<Response> {
  return getVaultGrantService().changeGrant(request);
}
