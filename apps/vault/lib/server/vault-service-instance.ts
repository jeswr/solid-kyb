import { vaultGrantConfig } from "./config";
import { createVaultGrantService, type VaultGrantService } from "./vault-grant-service";

/**
 * Module-scope singleton (construct ONCE): the guard owns the DPoP verifier's issuer
 * discovery, JWKS cache, and jti replay store — a per-request instance would let a
 * captured DPoP proof replay cleanly (`@jeswr/solid-pod-guard` SKILL.md).
 */
let service: VaultGrantService | undefined;

export function getVaultGrantService(): VaultGrantService {
  service ??= createVaultGrantService({ config: vaultGrantConfig() });
  return service;
}
