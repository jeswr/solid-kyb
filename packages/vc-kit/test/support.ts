/**
 * Shared test rig: fixed instants (the library never reads the clock, so the
 * suite doesn't either), a deterministic issuer key, an in-memory HTTP host
 * for status lists, and valid claim fixtures per credential kind.
 */

import { generateKeyPairForSuite, type KeyPair } from "@jeswr/solid-vc";
import { buildIllustrativeLei, KYB } from "@kyb/data-model";
import type { DatasetCore } from "@rdfjs/types";
import { Parser, Store } from "n3";
import type {
  BeneficialOwnershipClaims,
  CredentialKind,
  IssuedCredential,
  KybCredentialClaims,
  OfficerAuthorizationClaims,
  OrganisationalIdentityClaims,
  ZkOperandAnchorClaims,
} from "../src/index.ts";
import { issueCredential, StatusListClient } from "../src/index.ts";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The suite's "wall clock" — explicit everywhere. */
export const NOW = new Date("2026-07-22T12:00:00.000Z");
/** Backdated freshness window: -60d .. +305d around NOW (design §5 scene 1). */
export const BACKDATED_VALIDITY = {
  validFrom: new Date(NOW.getTime() - 60 * DAY_MS),
  validUntil: new Date(NOW.getTime() + 305 * DAY_MS),
};

export const ISSUER = "https://issuers.example/orgs/beneficial-ownership-registrar#id";
export const KEY_ID = `${ISSUER}#key-1`;
export const SUBJECT = "https://northwind.pod.example/profile/card#me";
export const LIST_URL = "https://issuers.example/status/beneficial-ownership";
export const CREDENTIAL_ID = "https://northwind.pod.example/kyb/credentials/beneficial-ownership";

let cachedKey: Promise<KeyPair> | undefined;
/** One deterministic-enough Ed25519 issuer key per suite run. */
export function issuerKey(): Promise<KeyPair> {
  cachedKey ??= generateKeyPairForSuite(KEY_ID, "Ed25519");
  return cachedKey;
}

/** `resolveKey` stub: exactly the issuer key, fail-closed for anything else. */
export async function resolveIssuerKey(verificationMethod: string): Promise<CryptoKey | undefined> {
  const key = await issuerKey();
  return verificationMethod === key.verificationMethod ? key.publicKey : undefined;
}

export interface StubHost {
  readonly fetch: typeof fetch;
  readonly resources: Map<string, { body: string; contentType: string; version: number }>;
}

/**
 * A tiny in-memory resource host honouring GET / PUT with `ETag`,
 * `If-None-Match: *` and `If-Match` — the surface StatusListClient uses.
 */
export function stubHost(): StubHost {
  const resources = new Map<string, { body: string; contentType: string; version: number }>();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const existing = resources.get(url);
    if (method === "PUT") {
      if (headers.get("if-none-match") === "*" && existing !== undefined) {
        return new Response(null, { status: 412 });
      }
      const ifMatch = headers.get("if-match");
      if (ifMatch !== null && (existing === undefined || `"v${existing.version}"` !== ifMatch)) {
        return new Response(null, { status: 412 });
      }
      const version = (existing?.version ?? 0) + 1;
      resources.set(url, {
        body: String(init?.body ?? ""),
        contentType: headers.get("content-type") ?? "application/octet-stream",
        version,
      });
      return new Response(null, { status: existing === undefined ? 201 : 204 });
    }
    if (existing === undefined) return new Response("not found", { status: 404 });
    return new Response(existing.body, {
      status: 200,
      headers: { "content-type": existing.contentType, etag: `"v${existing.version}"` },
    });
  };
  return { fetch: fetchImpl, resources };
}

/** A hosted, all-clear revocation list on the stub host. */
export async function hostedStatusList(
  host: StubHost,
  overrides: Partial<ConstructorParameters<typeof StatusListClient>[0]> = {},
): Promise<StatusListClient> {
  const client = new StatusListClient({
    url: LIST_URL,
    issuer: ISSUER,
    key: await issuerKey(),
    fetch: host.fetch,
    ...overrides,
  });
  await client.create({ now: NOW });
  return client;
}

export function orgIdentityClaims(
  overrides: Partial<OrganisationalIdentityClaims> = {},
): OrganisationalIdentityClaims {
  return {
    kind: "org-identity-credential",
    businessName: "Northwind Logistics LLC",
    address: {
      streetAddress: "1180 Freight Yard Road",
      addressLocality: "Kansas City",
      addressRegion: "MO",
      postalCode: "64105",
    },
    lei: buildIllustrativeLei("NWLOGISTICS001"),
    legalForm: KYB.EntityLegalForm_LLC,
    ...overrides,
  };
}

export function beneficialOwnershipClaims(
  overrides: Partial<BeneficialOwnershipClaims> = {},
): BeneficialOwnershipClaims {
  return {
    kind: "beneficial-ownership-credential",
    ownershipRecords: [
      { ownerName: "Jordan Blake", ownershipPercentage: 42, ownershipPercentageBps: 4200 },
      { ownerName: "Priya Nandakumar", ownershipPercentage: 28, ownershipPercentageBps: 2800 },
      { ownerName: "Marcus Webb", ownershipPercentage: 18, ownershipPercentageBps: 1800 },
      { ownerName: "Dana Reyes", ownershipPercentage: 12, ownershipPercentageBps: 1200 },
    ],
    ...overrides,
  };
}

export function officerAuthorizationClaims(
  overrides: Partial<OfficerAuthorizationClaims> = {},
): OfficerAuthorizationClaims {
  return {
    kind: "officer-authorization-credential",
    officer: { officerName: "Jordan Blake", jobTitle: "Managing Member & CEO" },
    ...overrides,
  };
}

export function anchorClaims(
  overrides: Partial<ZkOperandAnchorClaims> = {},
): ZkOperandAnchorClaims {
  return {
    kind: "zk-operand-anchor",
    field: KYB.ownershipPercentageBps,
    operandEnc: "0x07b66a6df9e52198d3d823f29c5030fd9721dafcf31b7a44da67a0f21d3710b0",
    ...overrides,
  };
}

/** Issue the canonical beneficial-ownership credential against `list`. */
export async function issueBeneficialOwnership(list: StatusListClient, index = 42) {
  return issueCredential({
    kind: "beneficial-ownership-credential",
    credentialId: CREDENTIAL_ID,
    issuer: ISSUER,
    subject: SUBJECT,
    claims: beneficialOwnershipClaims(),
    validity: BACKDATED_VALIDITY,
    status: list.entry(index),
    key: await issuerKey(),
  });
}

/** Issue any credential kind against `list` (generalises {@link issueBeneficialOwnership}). */
export async function issueCredentialAt(
  list: StatusListClient,
  options: {
    kind: CredentialKind;
    credentialId: string;
    claims: KybCredentialClaims;
    index: number;
    subject?: string;
    validity?: { validFrom: Date; validUntil?: Date };
  },
): Promise<IssuedCredential> {
  return issueCredential({
    kind: options.kind,
    credentialId: options.credentialId,
    issuer: ISSUER,
    subject: options.subject ?? SUBJECT,
    claims: options.claims,
    validity: options.validity ?? BACKDATED_VALIDITY,
    status: list.entry(options.index),
    key: await issuerKey(),
  });
}

/** Parse a Turtle credential document into a mutable Store. */
export function parseTurtle(body: string): Store & DatasetCore {
  return new Store(new Parser({ format: "text/turtle" }).parse(body));
}
