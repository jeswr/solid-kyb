/**
 * The cross-app KYB journey's DPoP-bound Solid-OIDC identities. Ported from
 * `jeswr/solid-lending`'s `e2e/support/dev-issuers.ts` (read-only reference,
 * the proven, already-passing recipe) — the SAME two identity shapes:
 *
 * - `startDevUserIssuer` — a BUSINESS's own presenter (Northwind/Jordan
 *   Blake, or the scene-4 hidden-owner variant business): the identity
 *   presented to every zone app's own pod-guard-fronted routes AND DIRECTLY
 *   TO THE POD ITSELF (ACL rewrites this suite performs as the business).
 *   The journey's pods boot `oidc: true` (real Solid-OIDC + DPoP
 *   verification); the pod's own native OIDC verifier
 *   (`@solid/access-token-verifier`) has NO loopback exception and
 *   hard-requires a GENUINE TLS dereference of the WebID document — so this
 *   runs a REAL HTTPS listener (a freshly generated self-signed loopback
 *   cert via `openssl`, `relaxTlsVerificationForTests()` trusting it for
 *   outbound fetches in this process only), bound to the "localhost"
 *   hostname (not the "127.0.0.1" literal — see `htuOf`'s header and
 *   `listenOnFreePort`'s below). This is ALSO what genuinely exercises
 *   `@jeswr/solid-pod-guard`'s FIXED owner-binding fetch
 *   (`loopbackMappedFetch`, `packages/solid-pod-guard/src/owner.ts`): a
 *   `https://localhost:<port>` WebID backed by a TLS-only listener makes the
 *   guard's first (plain-HTTP stand-in) attempt fail to connect, forcing the
 *   NEW https-fallback branch — the exact bug this journey exists to prove
 *   fixed (never exercised by an all-plain-HTTP or claimed-but-unserved-https
 *   caller identity).
 * - `startDevServiceIssuer` — a zone app's OWN L4 service identity: a plain
 *   HTTP dev issuer implementing the `client_credentials` grant
 *   `@jeswr/solid-pod-guard`'s `createServicePodFetch` performs. Plain HTTP
 *   is fine here: this identity only ever presents to the pod via each
 *   app's OWN `createServicePodFetch`, whose bearer token the pod verifies
 *   the same way regardless of transport.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  SignJWT,
} from "jose";

const TOKEN_LIFETIME_SECONDS = 300;
const TOKEN_REFRESH_MS = 60_000;

let tlsVerificationRelaxed = false;
/** Trust this process's self-signed dev certs for outbound fetches (test process only). */
function relaxTlsVerificationForTests(): void {
  if (tlsVerificationRelaxed) return;
  tlsVerificationRelaxed = true;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

/** Generate a fresh self-signed loopback TLS cert via the system `openssl` (dev/test only). */
function generateSelfSignedCert(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), "kyb-e2e-dev-issuer-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-nodes",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ]);
  return { cert: readFileSync(certPath, "utf8"), key: readFileSync(keyPath, "utf8") };
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function readBody(request: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Bind on the "localhost" HOSTNAME, never the "127.0.0.1" literal —
 * `@solid/access-token-verifier`'s `verifySecureUriClaim` (the pod's real
 * OIDC verifier, `oidc: true`) accepts `https:` OR `http:` ONLY when
 * `url.hostname`'s last dot-label is exactly `"localhost"` — a bare IP
 * literal fails that check unconditionally.
 */
function listenOnFreePort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "localhost", () => {
      const address = server.address() as AddressInfo | null;
      if (address === null) {
        reject(new Error("dev issuer failed to bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

/**
 * RFC 9449: `htu` binds scheme/authority/path only. Next.js strips a
 * basePath-configured app's `basePath` from `request.url` inside a Route
 * Handler; the caller's DPoP proof binds the FULL public URL it actually
 * requested, so a route MUST re-add the basePath before comparing — confirmed
 * empirically (`DPoP proof htu mismatch` otherwise). Only TWO of this repo's
 * apps actually own a `lib/server/url.ts` re-add helper AND wire it into
 * their real service singleton: `apps/issuers` (`issuer-rail.ts` defaults to
 * `url.ts`'s `publicRequestUrl`) and `apps/bank-credit`
 * (`decision-rail.ts` ditto). The other two silently do NOT:
 * `apps/bank-onboarding` has no `lib/server/url.ts` at all — its
 * `onboarding-rail.ts` defines its OWN local no-op default
 * (`(request) => request.url`); `apps/vault`'s `vault-grant-service.ts`
 * passes no `publicRequestUrl` at all, falling through to
 * `@jeswr/solid-pod-guard`'s own bare-`request.url` default. Both are real,
 * disclosed app-code gaps (out of e2e/* scope to fix) — this journey routes
 * around them the same way it already had to for `/vault` by matching the
 * SAME (basePath-missing) htu those two apps actually compute.
 */
const STRIPPED_HTU_PATH_PREFIXES = ["/vault/", "/bank-onboarding/"];

function htuOf(url: string): string {
  const parsed = new URL(url);
  const strip = STRIPPED_HTU_PATH_PREFIXES.find((prefix) => parsed.pathname.startsWith(prefix));
  const pathname = strip === undefined ? parsed.pathname : parsed.pathname.slice(strip.length - 1);
  return `${parsed.origin}${pathname}`;
}

export interface ClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface DevServiceIssuer {
  readonly issuer: string;
  readonly webId: string;
  stop(): Promise<void>;
}

/**
 * Start a dev OIDC issuer that (a) publishes discovery + JWKS + a WebID
 * profile (at `<issuer>/profile#id`) binding that WebID to this issuer, and
 * (b) accepts a `client_credentials` token request for the configured client
 * pair, minting a DPoP-bound `at+jwt` for that WebID.
 */
export async function startDevServiceIssuer(options: {
  clients: readonly ClientCredentials[];
}): Promise<DevServiceIssuer> {
  const issuerKeys = await generateKeyPair("ES256", { extractable: true });
  const issuerJwk = {
    ...(await exportJWK(issuerKeys.publicKey)),
    alg: "ES256",
    kid: "issuer-signing-key",
    use: "sig",
  };

  let issuer = "";
  let webId = "";
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://placeholder");
      if (url.pathname === "/profile" && request.method === "GET") {
        response.setHeader("content-type", "text/turtle");
        response.end(`<${webId}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}> .\n`);
        return;
      }
      if (url.pathname === "/.well-known/openid-configuration" && request.method === "GET") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks`, token_endpoint: `${issuer}/token` }),
        );
        return;
      }
      if (url.pathname === "/jwks" && request.method === "GET") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ keys: [issuerJwk] }));
        return;
      }
      if (url.pathname === "/token" && request.method === "POST") {
        const body = await readBody(request);
        const params = new URLSearchParams(body);
        const clientId = params.get("client_id");
        const clientSecret = params.get("client_secret");
        const grantType = params.get("grant_type");
        const matched = options.clients.find(
          (client) => client.clientId === clientId && client.clientSecret === clientSecret,
        );
        if (grantType !== "client_credentials" || matched === undefined) {
          response.statusCode = 401;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: "invalid_client" }));
          return;
        }
        const dpopHeader = request.headers.dpop;
        if (typeof dpopHeader !== "string") {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: "invalid_dpop_proof" }));
          return;
        }
        let jkt: string;
        try {
          const decoded = JSON.parse(
            Buffer.from(dpopHeader.split(".")[0] ?? "", "base64url").toString("utf8"),
          ) as { jwk?: JsonWebKey };
          if (decoded.jwk === undefined) throw new Error("dpop proof carries no embedded jwk");
          const publicKey = await importJWK(decoded.jwk, "ES256");
          await jwtVerify(dpopHeader, publicKey, { typ: "dpop+jwt" });
          jkt = await calculateJwkThumbprint(decoded.jwk);
        } catch {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: "invalid_dpop_proof" }));
          return;
        }
        const seconds = Math.floor(Date.now() / 1000);
        const accessToken = await new SignJWT({
          client_id: clientId,
          cnf: { jkt },
          webid: webId,
          sub: webId,
        })
          .setProtectedHeader({ alg: "ES256", kid: issuerJwk.kid, typ: "at+jwt" })
          .setIssuer(issuer)
          .setAudience("solid")
          .setIssuedAt(seconds)
          .setExpirationTime(seconds + TOKEN_LIFETIME_SECONDS)
          .sign(issuerKeys.privateKey);
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: accessToken,
            expires_in: TOKEN_LIFETIME_SECONDS,
            token_type: "DPoP",
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    })().catch((error: unknown) => {
      response.statusCode = 500;
      response.end(String(error));
    });
  });
  const port = await listenOnFreePort(server);
  // "localhost", NOT "127.0.0.1" — see `listenOnFreePort`'s header.
  issuer = `http://localhost:${port}`;
  webId = `${issuer}/profile#id`;

  return {
    issuer,
    stop: () => closeServer(server),
    webId,
  };
}

export interface BusinessSession {
  readonly issuer: string;
  readonly webid: string;
  /** An authenticated fetch minting a fresh DPoP proof + presenting the cached bearer token per call. */
  authFetch: typeof fetch;
  /** Intercept the browser page's own requests matching `pattern`, attaching the SAME real DPoP auth. */
  authenticatePage(page: Page, pattern: string): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Start one business's presenter — the identity presented to every zone
 * app's own routes AND directly to the pod server (real Solid-OIDC + DPoP
 * over a REAL HTTPS loopback listener — see the module header). `storage`
 * names its `pim:storage` claim (the L2 forward binding
 * `resolveAuthorizedPod` reads) — the pod's base URL.
 */
export async function startDevUserIssuer(options: { storage: string }): Promise<BusinessSession> {
  relaxTlsVerificationForTests();
  const issuerKeys = await generateKeyPair("ES256", { extractable: true });
  const issuerJwk = {
    ...(await exportJWK(issuerKeys.publicKey)),
    alg: "ES256",
    kid: "issuer-signing-key",
    use: "sig",
  };
  const dpopKeys = await generateKeyPair("ES256", { extractable: true });
  const dpopJwk = await exportJWK(dpopKeys.publicKey);
  const thumbprint = await calculateJwkThumbprint(dpopJwk);

  let issuer = "";
  let webId = "";
  const { key, cert } = generateSelfSignedCert();
  const server = createHttpsServer({ cert, key }, (request, response) => {
    if (request.url === "/profile" && request.method === "GET") {
      response.setHeader("content-type", "text/turtle");
      response.end(
        `<${webId}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}> .\n` +
          `<${webId}> <http://www.w3.org/ns/pim/space#storage> <${options.storage}> .\n`,
      );
      return;
    }
    if (request.url === "/.well-known/openid-configuration" && request.method === "GET") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
      return;
    }
    if (request.url === "/jwks" && request.method === "GET") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [issuerJwk] }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "localhost", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("dev user issuer failed to bind a TCP port");
  }
  // REAL HTTPS, same origin for issuer + WebID — see the module header for
  // why a genuine TLS dereference is required here.
  issuer = `https://localhost:${address.port}`;
  webId = `${issuer}/profile#id`;

  let cachedToken: { value: string; mintedAt: number } | undefined;
  async function accessToken(): Promise<string> {
    const now = Date.now();
    if (cachedToken !== undefined && now - cachedToken.mintedAt < TOKEN_REFRESH_MS) {
      return cachedToken.value;
    }
    const seconds = Math.floor(now / 1000);
    const value = await new SignJWT({ cnf: { jkt: thumbprint }, webid: webId })
      .setProtectedHeader({ alg: "ES256", kid: issuerJwk.kid, typ: "at+jwt" })
      .setIssuer(issuer)
      .setSubject(webId)
      .setAudience("solid")
      .setIssuedAt(seconds)
      .setExpirationTime(seconds + TOKEN_LIFETIME_SECONDS)
      .sign(issuerKeys.privateKey);
    cachedToken = { value, mintedAt: now };
    return value;
  }

  async function authHeaders(
    method: string,
    url: string,
  ): Promise<{ authorization: string; dpop: string }> {
    const token = await accessToken();
    const ath = createHash("sha256").update(token, "ascii").digest("base64url");
    const proof = await new SignJWT({ ath, htm: method, htu: htuOf(url), jti: randomUUID() })
      .setProtectedHeader({ alg: "ES256", jwk: dpopJwk, typ: "dpop+jwt" })
      .setIssuedAt()
      .sign(dpopKeys.privateKey);
    return { authorization: `DPoP ${token}`, dpop: proof };
  }

  return {
    issuer,
    webid: webId,
    async authFetch(input, init = {}) {
      const request = new Request(input instanceof Request ? input : String(input), init);
      const target = new URL(request.url);
      const headers = new Headers(request.headers);
      const auth = await authHeaders(request.method, request.url);
      headers.set("authorization", auth.authorization);
      headers.set("dpop", auth.dpop);
      headers.set("x-forwarded-host", target.host);
      headers.set("x-forwarded-proto", target.protocol.replace(/:$/, ""));
      return fetch(new Request(request, { headers }));
    },
    async authenticatePage(page, pattern) {
      await page.route(pattern, async (route) => {
        const request = route.request();
        const target = new URL(request.url());
        const auth = await authHeaders(request.method(), request.url());
        await route.continue({
          headers: {
            ...request.headers(),
            ...auth,
            "x-forwarded-host": target.host,
            "x-forwarded-proto": target.protocol.replace(/:$/, ""),
          },
        });
      });
    },
    stop: () => closeServer(server),
  };
}
