import { getVaultGrantService } from "../../../lib/server/vault-service-instance";

/**
 * The access-grant dashboard (design §5/§6 scenes 2/4/6): every OPERATOR-CONFIGURED party
 * plus this pod's live standing per grantable credential. Real auth
 * (`@jeswr/solid-pod-guard`) — anonymous ⇒ 401.
 */
export async function GET(request: Request): Promise<Response> {
  return getVaultGrantService().grants(request);
}
