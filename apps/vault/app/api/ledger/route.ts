import { getVaultGrantService } from "../../../lib/server/vault-service-instance";

/**
 * The scene-6 consent-receipt + ODRL grant ledger: the vault's authoritative
 * `/kyb/receipts/` records plus any root-level records other apps in the journey have
 * written, time-ordered. Real auth — anonymous ⇒ 401.
 */
export async function GET(request: Request): Promise<Response> {
  return getVaultGrantService().ledger(request);
}
