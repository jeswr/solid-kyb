/**
 * A REAL DPoP-bound Solid-OIDC dev issuer for the CALLER identity (the
 * business, Northwind Logistics LLC / Jordan Blake) that hits
 * `@jeswr/solid-pod-guard`-fronted routes — copied verbatim from
 * `apps/vault/test/support/caller-issuer.ts` / `apps/issuers/test/issuer-rail.test.ts`'s
 * own inline copy, kept consistent across this demo suite's test
 * infrastructure rather than reinvented per app. See that module's header
 * for why the caller identity claims an `https:` WebID rather than
 * `@kyb/test-kit`'s bundled `http://localhost:<port>` dev-issuer WebIDs.
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { base64url, calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from "jose";

const TOKEN_LIFETIME_SECONDS = 300;

export interface TestCallerIssuer {
  readonly webid: string;
  readonly origin: string;
  /** The pod this WebID's profile claims via `pim:storage`. Unset = the caller genuinely
   * claims no storage (the "unbound" 403 case). */
  setStorage(storage: string): void;
  /** An authenticated fetch minting a fresh DPoP-bound access token per call. */
  readonly fetch: typeof fetch;
  close(): Promise<void>;
}

export async function createTestCallerIssuer(): Promise<TestCallerIssuer> {
  const issuerKeys = await generateKeyPair("ES256", { extractable: true });
  const issuerJwk = {
    ...(await exportJWK(issuerKeys.publicKey)),
    alg: "ES256",
    kid: "issuer-signing-key",
    use: "sig",
  };

  let issuer = "";
  let webid = "";
  let storage: string | undefined;

  const server: Server = createServer((request, response) => {
    if (request.url === "/profile") {
      response.setHeader("content-type", "text/turtle");
      const lines = [`<${webid}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}> .`];
      if (storage !== undefined) {
        lines.push(`<${webid}> <http://www.w3.org/ns/pim/space#storage> <${storage}> .`);
      }
      response.end(`${lines.join("\n")}\n`);
      return;
    }
    if (request.url === "/.well-known/openid-configuration") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
      return;
    }
    if (request.url === "/jwks") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [issuerJwk] }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  issuer = `http://127.0.0.1:${address.port}`;
  webid = `https://127.0.0.1:${address.port}/profile#me`;

  const dpopKeys = await generateKeyPair("ES256", { extractable: true });
  const dpopJwk = await exportJWK(dpopKeys.publicKey);
  const thumbprint = await calculateJwkThumbprint(dpopJwk);

  async function accessToken(): Promise<string> {
    const seconds = Math.floor(Date.now() / 1000);
    return new SignJWT({
      client_id: "https://app.example/client",
      cnf: { jkt: thumbprint },
      webid,
      sub: webid,
    })
      .setProtectedHeader({ alg: "ES256", kid: issuerJwk.kid, typ: "at+jwt" })
      .setIssuer(issuer)
      .setAudience("solid")
      .setIssuedAt(seconds)
      .setExpirationTime(seconds + TOKEN_LIFETIME_SECONDS)
      .sign(issuerKeys.privateKey);
  }

  const callerFetch: typeof fetch = async (input, init) => {
    const request = new Request(input instanceof Request ? input : String(input), init);
    const url = new URL(request.url);
    const htu = `${url.origin}${url.pathname}`;
    const token = await accessToken();
    const ath = base64url.encode(createHash("sha256").update(token, "ascii").digest());
    const proof = await new SignJWT({ ath, htm: request.method, htu, jti: randomUUID() })
      .setProtectedHeader({ alg: "ES256", jwk: dpopJwk, typ: "dpop+jwt" })
      .setIssuedAt()
      .sign(dpopKeys.privateKey);
    const headers = new Headers(request.headers);
    headers.set("authorization", `DPoP ${token}`);
    headers.set("dpop", proof);
    return fetch(new Request(request, { headers }));
  };

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    fetch: callerFetch,
    origin: issuer,
    setStorage(value: string) {
      storage = value;
    },
    webid,
  };
}
