/**
 * The cross-app KYB journey: Northwind Logistics LLC (Jordan Blake, Managing
 * Member) fills its Data Vault, a live-issued Organisational-Identity +
 * Officer-Authorization + Beneficial-Ownership credential set is verified in
 * the vault, Bank of America-modelled `bank-onboarding` runs the REAL
 * beneficial-ownership completeness ZK check and approves, a "hidden >=25%
 * owner" counterfactual variant is DECLINED on the same rail
 * (`STATEMENT_MISMATCH`), Fifth-Third-modelled `bank-credit` REUSES the same
 * credentials with zero re-collection, and the business revokes a bank's
 * access — the ledger and the pod's own WAC both reflect it for real.
 *
 * Real cross-zone DPoP throughout, driven against FIVE real Next.js servers
 * (never mocked/`route.fulfill`'d): `tour`, `vault`, `issuers`,
 * `bank-onboarding`, `bank-credit`.
 *
 * SEEDING NOTE (read before touching this file): this repo currently has
 * THREE mutually-inconsistent app-local seeding conventions for issuer
 * WebIDs and ZK-anchor paths (`@kyb/seeds`'s `seedKybPod`, `apps/vault`'s own
 * dev seeder, `apps/bank-onboarding`'s test seeder) — see
 * `support/kyb-fixtures.ts`'s header for the full breakdown. This journey
 * seeds Northwind's pod at the ONE convention that actually satisfies every
 * app this journey drives (vault's verify-on-view issuer paths PLUS
 * bank-onboarding's ZK-anchor paths, which happen to be exactly what the
 * LIVE `apps/issuers` app produces) and mints its Tier B array-commitment
 * anchor + THREE credentials through that LIVE issuers app (a genuinely
 * cross-zone DPoP call), not any offline seeder.
 *
 * A CONFIRMED, DISCLOSED FRONT-END GAP (not touched — out of this journey's
 * scope): `apps/vault`'s own `credentials`/`grants`/`ledger` pages call
 * `fetch("/api/...")` WITHOUT `apps/vault`'s (absent) `BASE_PATH` prefix
 * (unlike `apps/issuers`'s `issue-panel.tsx`, which correctly does). Verified
 * directly: `GET /vault/api/grants` -> 503 (rail reached, unconfigured);
 * `GET /api/grants` (what the browser's relative `fetch("/api/grants")`
 * actually requests when the page is served under the `/vault` basePath) ->
 * 404. Every vault UI "Load…"/"Grant"/"Revoke" button is unreachable through
 * the browser in ANY basePath-mounted deployment — including this journey's
 * own AppRunner boot, which reproduces production `basePath` config exactly.
 * This journey therefore (a) visits every vault page for the trust-frame +
 * axe checks (the page itself renders fine), and (b) drives every vault
 * grant/revoke/ledger/verify-on-view TRANSITION via the correct,
 * basePath-prefixed URL directly (still the app's own real server-side rail,
 * still real DPoP, still a real WAC rewrite — never a mock) rather than via
 * the broken button. Report this finding; do not silently route around it in
 * app code (out of e2e/* scope).
 */
import { type BeneficialOwnerValues, RESOURCE_POD_PATHS } from "@kyb/data-model";
import { type SolidTestAccount, type SolidTestServer, startSolidServer } from "@kyb/test-kit";
import {
  exportPrivateJwk,
  ownershipArrayCommitment,
  prewarmProver,
  proveCompleteness,
  proveOwnerThreshold,
  type TierAProof,
} from "@kyb/vc-kit";
import { expect, test } from "@playwright/test";
import { AppRunner, buildApps } from "./support/app-runner";
import { acknowledgeInterstitial, expectAxeClean, expectBannerVisible } from "./support/banners";
import {
  type BusinessSession,
  type DevServiceIssuer,
  startDevServiceIssuer,
  startDevUserIssuer,
} from "./support/dev-issuers";
import {
  ANCHOR_POD_PATHS,
  directGrantAcl,
  kybContainerAcl,
  mintSampleOwnerAnchor,
  NORTHWIND,
  provisionPodIssuer,
  publicReadAcl,
  publicReadAndVaultServiceAcl,
  SAMPLE_OWNER_BPS,
  SAMPLE_OWNER_OPERAND_ENC,
  seedHiddenOwnerVariant,
  type ProvisionedPodIssuer,
  type SeededHiddenOwnerVariant,
} from "./support/kyb-fixtures";

// Real production-mode cold starts (four apps) + one real `next dev` +
// real DPoP/UltraHonk-ZK round trips comfortably exceed Playwright's 30s
// default — both the beforeAll boot and every ZK-bearing scene's own budget.
test.describe.configure({ mode: "serial", timeout: 180_000 });
const PROVE_TIMEOUT = 180_000;

const runner = new AppRunner();

let pods: SolidTestServer;
let northwindAdmin: SolidTestAccount;
let variantAdmin: SolidTestAccount;
let northwindPodBase = "";
let variantPodBase = "";

let northwind: BusinessSession;
let variant: BusinessSession;

let vaultService: DevServiceIssuer;
let issuersService: DevServiceIssuer;
let bankOnboardingService: DevServiceIssuer;
let bankCreditService: DevServiceIssuer;

let orgIdentityRegistrar: ProvisionedPodIssuer;
let beneficialOwnershipRegistrar: ProvisionedPodIssuer;
let variantSeed: SeededHiddenOwnerVariant;

let seededAt = new Date();

const origins = {
  bankCredit: "",
  bankOnboarding: "",
  issuers: "",
  tour: "",
  vault: "",
};

const JOURNEY_START_PACKAGES = [
  "@kyb/app-tour",
  "@kyb/app-issuers",
  "@kyb/app-bank-onboarding",
  "@kyb/app-bank-credit",
] as const;

/** RFC 9449-shaped wire proof (Uint8Array -> plain number[] for JSON transport). */
function toWireProof(proof: {
  readonly member: string;
  readonly proof: Uint8Array;
  readonly publicInputs: readonly string[];
  readonly verifierTarget: string;
}): { member: string; proof: number[]; publicInputs: string[]; verifierTarget: string } {
  return {
    member: proof.member,
    proof: Array.from(proof.proof),
    publicInputs: [...proof.publicInputs],
    verifierTarget: proof.verifierTarget,
  };
}

async function putTurtle(fetchImpl: typeof fetch, iri: string, body: string): Promise<void> {
  const response = await fetchImpl(iri, {
    body,
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    method: "PUT",
  });
  if (!response.ok)
    throw new Error(`seed PUT ${iri} failed: ${response.status} ${await response.text()}`);
}

async function putAcl(fetchImpl: typeof fetch, resourceIri: string, turtle: string): Promise<void> {
  const response = await fetchImpl(`${resourceIri}.acl`, {
    body: turtle,
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    method: "PUT",
  });
  if (!response.ok) {
    throw new Error(
      `seed ACL PUT ${resourceIri}.acl failed: ${response.status} ${await response.text()}`,
    );
  }
}

function profileCardTurtle(webid: string, name: string, storage: string): string {
  return `@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix pim: <http://www.w3.org/ns/pim/space#> .
@prefix schema: <https://schema.org/> .

<${webid}>
    a foaf:Person, schema:Organization ;
    foaf:name "${name}" ;
    pim:storage <${storage}> .
`;
}

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires object-destructuring the first (fixtures) param even when unused.
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(900_000);

  // 0. Build the four PRODUCTION-mode apps before anything else — build time
  //    is CPU-bound and must not overlap the pod's own DPoP-sensitive crypto
  //    work below. `apps/vault` is EXCLUDED: its scene-1 verify-on-view route
  //    (`/api/dev/credentials`) is dev-gated (`NODE_ENV !== "production"`,
  //    no override exists in app code), so it boots under `next dev` below —
  //    ONE Turbopack dev server, not five, stays far under the CPU-
  //    starvation threshold `jeswr/solid-lending`'s sm-qz3j.8 reproduced.
  await buildApps([...JOURNEY_START_PACKAGES], (message) => console.log(message));

  // 1. Two REAL WAC-enforcing pods (`oidc: true`) — Northwind's own, and a
  //    SEPARATE pod for the scene-3 "hidden owner" counterfactual variant
  //    (never touching Northwind's real vault). `pod.accounts[0]` /
  //    `provisionAccount()` are test-kit's OWN self-provisioned bootstrap
  //    identities — ADMINISTRATIVE writers only, used to seed content and
  //    author ACLs; NEVER the resource owner named IN those ACLs (that is
  //    always the business's own real presenter, minted next).
  pods = await startSolidServer({ oidc: true });
  const primary = pods.accounts[0];
  if (primary === undefined) throw new Error("pod booted with no primary account");
  northwindAdmin = primary;
  northwindPodBase = `${new URL(northwindAdmin.baseUrl).origin}/`;

  variantAdmin = await pods.provisionAccount();
  variantPodBase = `${new URL(variantAdmin.baseUrl).origin}/`;

  // 2. Each business's OWN real presenter (WebID + Solid-OIDC issuer over a
  //    REAL HTTPS loopback listener — see `support/dev-issuers.ts`'s header
  //    for why this is what genuinely exercises the FIXED
  //    `@jeswr/solid-pod-guard` owner-binding fallback).
  [northwind, variant] = await Promise.all([
    startDevUserIssuer({ storage: northwindPodBase }),
    startDevUserIssuer({ storage: variantPodBase }),
  ]);

  // 3. Four per-app L4 service identities (client_credentials + DPoP).
  [vaultService, issuersService, bankOnboardingService, bankCreditService] = await Promise.all([
    startDevServiceIssuer({
      clients: [{ clientId: "vault-service", clientSecret: "e2e-vault-secret" }],
    }),
    startDevServiceIssuer({
      clients: [{ clientId: "issuers-service", clientSecret: "e2e-issuers-secret" }],
    }),
    startDevServiceIssuer({
      clients: [
        { clientId: "bank-onboarding-service", clientSecret: "e2e-bank-onboarding-secret" },
      ],
    }),
    startDevServiceIssuer({
      clients: [{ clientId: "bank-credit-service", clientSecret: "e2e-bank-credit-secret" }],
    }),
  ]);

  seededAt = new Date();

  // 4. The pod's own backward-acknowledgement profile cards (L2's
  //    bidirectional check) — public-read, written by each pod's bootstrap
  //    admin, naming the REAL business presenter's WebID.
  await Promise.all([
    putTurtle(
      northwindAdmin.authFetch,
      `${northwindPodBase}profile/card`,
      profileCardTurtle(northwind.webid, NORTHWIND.businessName, northwindPodBase),
    ),
    putTurtle(
      variantAdmin.authFetch,
      `${variantPodBase}profile/card`,
      profileCardTurtle(
        variant.webid,
        "Northwind Logistics LLC (hidden-owner counterfactual)",
        variantPodBase,
      ),
    ),
  ]);
  await Promise.all([
    putAcl(
      northwindAdmin.authFetch,
      `${northwindPodBase}profile/card`,
      publicReadAcl(`${northwindPodBase}profile/card`, northwind.webid),
    ),
    putAcl(
      variantAdmin.authFetch,
      `${variantPodBase}profile/card`,
      publicReadAcl(`${variantPodBase}profile/card`, variant.webid),
    ),
  ]);

  // 5. Northwind's `/kyb/` container: default ACL granting the business
  //    (Read/Write/Control) plus the issuers/vault service identities
  //    (Read/Write[/Control]) so they can create not-yet-existing resources
  //    under it (credentials, ZK anchors, issuer docs, status lists, the
  //    receipts + access-policies subcontainers). The variant pod needs NO
  //    such grants — its ENTIRE seed is written by its own bootstrap admin
  //    (which bypasses WAC for its own pod), and it is never touched by
  //    `vault`/`issuers`.
  const kybContainer = `${northwindPodBase}kyb/`;
  await putTurtle(northwindAdmin.authFetch, kybContainer, "");
  await putAcl(
    northwindAdmin.authFetch,
    kybContainer,
    kybContainerAcl(
      kybContainer,
      northwind.webid,
      northwindAdmin.webid,
      issuersService.webId,
      vaultService.webId,
      bankCreditService.webId,
    ),
  );

  // 6. Northwind's two pod-hosted issuer identities, at EXACTLY the paths
  //    `apps/vault`'s own verify-on-view route trusts (see this file's
  //    header / `support/kyb-fixtures.ts`'s header) — published now so the
  //    LIVE issuers app (configured with these same identities below) signs
  //    credentials a resolvable, ACL'd verification method already backs.
  [orgIdentityRegistrar, beneficialOwnershipRegistrar] = await Promise.all([
    provisionPodIssuer(
      northwindPodBase,
      "/kyb/issuers/org-identity",
      "/kyb/status/org-identity",
      northwindAdmin.authFetch,
    ),
    provisionPodIssuer(
      northwindPodBase,
      "/kyb/issuers/beneficial-ownership",
      "/kyb/status/beneficial-ownership",
      northwindAdmin.authFetch,
    ),
  ]);
  await Promise.all([
    putTurtle(
      northwindAdmin.authFetch,
      `${northwindPodBase}kyb/issuers/org-identity`,
      orgIdentityRegistrar.docBody,
    ),
    putTurtle(
      northwindAdmin.authFetch,
      `${northwindPodBase}kyb/issuers/beneficial-ownership`,
      beneficialOwnershipRegistrar.docBody,
    ),
  ]);
  await Promise.all([
    putAcl(
      northwindAdmin.authFetch,
      `${northwindPodBase}kyb/issuers/org-identity`,
      publicReadAcl(`${northwindPodBase}kyb/issuers/org-identity`, northwind.webid),
    ),
    putAcl(
      northwindAdmin.authFetch,
      `${northwindPodBase}kyb/issuers/beneficial-ownership`,
      publicReadAcl(`${northwindPodBase}kyb/issuers/beneficial-ownership`, northwind.webid),
    ),
  ]);

  // 7. Seed the ENTIRE scene-3 "hidden owner" counterfactual variant now
  //    (needs `bankOnboardingService.webId`, already minted in step 3) — its
  //    issuer WebIDs must be known BEFORE `bank-onboarding` boots, since its
  //    trusted-issuer allowlist is fixed at process env, not per-request.
  //    Marcus Webb's TRUE stake (2600 bps, >= threshold) diverges from what
  //    the DISCLOSED credential shows (1800 bps, < threshold) — three real
  //    owners are >= 25% but the disclosed credential only shows two,
  //    mirroring `apps/bank-onboarding/test/support/seed.ts`'s own proven
  //    adversarial fixture exactly.
  const hiddenOwnerDisclosed: readonly BeneficialOwnerValues[] = NORTHWIND.owners;
  const hiddenOwnerTrueBps = [4200, 2800, 2600, 1200] as const;
  variantSeed = await seedHiddenOwnerVariant({
    bankOnboardingServiceWebId: bankOnboardingService.webId,
    disclosedOwners: hiddenOwnerDisclosed,
    fetchImpl: variantAdmin.authFetch,
    now: seededAt,
    podBase: variantPodBase,
    trueOwnerBps: [...hiddenOwnerTrueBps],
    webid: variant.webid,
  });

  // 8. Boot all five apps. `apps/vault` runs `"dev"` (see step 0's header);
  //    the other four run `"start"` against their just-built bundles.
  const trustedOidcIssuers = `${northwind.issuer},${variant.issuer}`;
  const podAllowedOrigins = `${new URL(northwindPodBase).origin},${new URL(variantPodBase).origin}`;
  const shared = {
    KYB_DEV_ALLOW_LOOPBACK: "1",
    KYB_POD_ALLOWED_ORIGINS: podAllowedOrigins,
    KYB_TRUST_FORWARDED_HEADERS: "1",
    KYB_TRUSTED_OIDC_ISSUERS: trustedOidcIssuers,
  };

  const orgIdentityKeyJwk = JSON.stringify(await exportPrivateJwk(orgIdentityRegistrar.key));
  const beneficialOwnershipKeyJwk = JSON.stringify(
    await exportPrivateJwk(beneficialOwnershipRegistrar.key),
  );

  const [tour, issuers, vault, bankOnboarding, bankCredit] = await Promise.all([
    runner.start({
      basePath: "",
      command: "start",
      env: { ...shared },
      packageName: "@kyb/app-tour",
    }),
    runner.start({
      basePath: "/issuers",
      command: "start",
      env: {
        ...shared,
        KYB_ISSUERS_BENEFICIAL_OWNERSHIP_ISSUER_KEY_JWK: beneficialOwnershipKeyJwk,
        KYB_ISSUERS_BENEFICIAL_OWNERSHIP_ISSUER_KEY_VM:
          beneficialOwnershipRegistrar.verificationMethod,
        KYB_ISSUERS_BENEFICIAL_OWNERSHIP_ISSUER_WEBID: beneficialOwnershipRegistrar.webId,
        KYB_ISSUERS_BENEFICIAL_OWNERSHIP_STATUS_LIST_URL:
          beneficialOwnershipRegistrar.statusList.url,
        KYB_ISSUERS_OFFICER_AUTHORIZATION_ISSUER_KEY_JWK: orgIdentityKeyJwk,
        KYB_ISSUERS_OFFICER_AUTHORIZATION_ISSUER_KEY_VM: orgIdentityRegistrar.verificationMethod,
        KYB_ISSUERS_OFFICER_AUTHORIZATION_ISSUER_WEBID: orgIdentityRegistrar.webId,
        // A DELIBERATELY DIFFERENT status list from org-identity's own: two
        // issuer FLOWS sharing one status list would each allocate their
        // (independent) `StatusIndexAllocator` from index 0 — a real
        // index collision, not a demo-persona choice.
        KYB_ISSUERS_OFFICER_AUTHORIZATION_STATUS_LIST_URL: `${northwindPodBase}kyb/status/officer-authorization`,
        KYB_ISSUERS_ORG_IDENTITY_ISSUER_KEY_JWK: orgIdentityKeyJwk,
        KYB_ISSUERS_ORG_IDENTITY_ISSUER_KEY_VM: orgIdentityRegistrar.verificationMethod,
        KYB_ISSUERS_ORG_IDENTITY_ISSUER_WEBID: orgIdentityRegistrar.webId,
        KYB_ISSUERS_ORG_IDENTITY_STATUS_LIST_URL: orgIdentityRegistrar.statusList.url,
        KYB_ISSUERS_POD_SERVICE_CLIENT_ID: "issuers-service",
        KYB_ISSUERS_POD_SERVICE_CLIENT_SECRET: "e2e-issuers-secret",
        KYB_ISSUERS_POD_SERVICE_ISSUER: issuersService.issuer,
        KYB_ISSUERS_SERVICE_WEBID: issuersService.webId,
      },
      packageName: "@kyb/app-issuers",
    }),
    runner.start({
      basePath: "/vault",
      // Dev mode — see step 0's header.
      env: {
        ...shared,
        KYB_BANK_CREDIT_SERVICE_WEBID: bankCreditService.webId,
        KYB_BANK_ONBOARDING_SERVICE_WEBID: bankOnboardingService.webId,
        // Dev-only verify-on-view target (`/api/dev/credentials`) — see this
        // file's header for the confirmed basePath-relative-fetch gap this
        // journey routes around (never through app-code changes).
        KYB_SEED_POD_URL: northwindPodBase,
        KYB_SEED_WEBID: northwind.webid,
        KYB_VAULT_POD_SERVICE_CLIENT_ID: "vault-service",
        KYB_VAULT_POD_SERVICE_CLIENT_SECRET: "e2e-vault-secret",
        KYB_VAULT_POD_SERVICE_ISSUER: vaultService.issuer,
        KYB_VAULT_SERVICE_WEBID: vaultService.webId,
      },
      packageName: "@kyb/app-vault",
    }),
    runner.start({
      basePath: "/bank-onboarding",
      command: "start",
      env: {
        ...shared,
        KYB_BANK_ONBOARDING_POD_SERVICE_CLIENT_ID: "bank-onboarding-service",
        KYB_BANK_ONBOARDING_POD_SERVICE_CLIENT_SECRET: "e2e-bank-onboarding-secret",
        KYB_BANK_ONBOARDING_POD_SERVICE_ISSUER: bankOnboardingService.issuer,
        KYB_BANK_ONBOARDING_SERVICE_WEBID: bankOnboardingService.webId,
        KYB_BANK_ONBOARDING_TRUSTED_CREDENTIAL_ISSUERS: [
          orgIdentityRegistrar.webId,
          beneficialOwnershipRegistrar.webId,
          variantSeed.orgIdentityRegistrarWebId,
          variantSeed.beneficialOwnershipRegistrarWebId,
        ].join(","),
      },
      packageName: "@kyb/app-bank-onboarding",
    }),
    runner.start({
      basePath: "/bank-credit",
      command: "start",
      env: {
        ...shared,
        KYB_BANK_CREDIT_POD_SERVICE_CLIENT_ID: "bank-credit-service",
        KYB_BANK_CREDIT_POD_SERVICE_CLIENT_SECRET: "e2e-bank-credit-secret",
        KYB_BANK_CREDIT_POD_SERVICE_ISSUER: bankCreditService.issuer,
        KYB_BANK_CREDIT_SERVICE_WEBID: bankCreditService.webId,
        KYB_BANK_CREDIT_TRUSTED_CREDENTIAL_ISSUERS: [
          orgIdentityRegistrar.webId,
          beneficialOwnershipRegistrar.webId,
        ].join(","),
      },
      packageName: "@kyb/app-bank-credit",
    }),
  ]);

  origins.tour = tour.origin;
  origins.issuers = issuers.origin;
  origins.vault = vault.origin;
  origins.bankOnboarding = bankOnboarding.origin;
  origins.bankCredit = bankCredit.origin;

  // Pre-warm the ZK provers (dynamic imports + WASM instantiate + committed
  // artifacts) so the FIRST proof in scene 2 pays no cold start on top of the
  // real DPoP round trip.
  await prewarmProver();
});

test.afterAll(async () => {
  await runner.stopAll();
  await Promise.all([
    pods?.stop(),
    northwind?.stop(),
    variant?.stop(),
    vaultService?.stop(),
    issuersService?.stop(),
    bankOnboardingService?.stop(),
    bankCreditService?.stop(),
  ]);
});

test("scene 1: fill the vault — live issuance through the issuers app, verified in the vault", async ({
  page,
}) => {
  await northwind.authenticatePage(page, "**/issuers/api/**");

  for (const flow of ["org-identity", "officer-authorization", "beneficial-ownership"] as const) {
    await page.goto(`${origins.issuers}/issuers/${flow}`);
    await acknowledgeInterstitial(page);
    await expect(page.locator("[data-flow-page]")).toHaveAttribute("data-flow-page", flow);
    await expectBannerVisible(page);
    await page.getByRole("button", { name: "Issue credential" }).click();
    await expect(page.locator("[data-panel-outcome]")).toHaveAttribute("data-panel-outcome", "ok", {
      timeout: 30_000,
    });
    await expectAxeClean(page);
  }

  // `apps/vault`'s dev-only verify-on-view route (`/api/dev/credentials`,
  // `lib/server/credential-summary.ts`) reads each credential with a PLAIN
  // unauthenticated `fetch` — confirmed by direct inspection, it was written
  // for a fixed-owner (no-OIDC) dev pod, never a real per-session read (this
  // scaffold "has no business login UI yet", vault's own comment). Make the
  // three just-issued credentials public-read for this brief pre-grant
  // window ONLY: the very first `vault` grant in scene 2 REBUILDS each
  // resource's ACL from scratch (owner + vault-service + granted parties),
  // which drops this public rule entirely — the later, real WAC/revoke
  // assertions in scenes 2-5 are never weakened by it.
  for (const path of [
    RESOURCE_POD_PATHS["org-identity-credential"],
    RESOURCE_POD_PATHS["beneficial-ownership-credential"],
    RESOURCE_POD_PATHS["officer-authorization-credential"],
  ]) {
    await putAcl(
      northwindAdmin.authFetch,
      `${northwindPodBase}${path.slice(1)}`,
      publicReadAndVaultServiceAcl(
        `${northwindPodBase}${path.slice(1)}`,
        northwind.webid,
        vaultService.webId,
      ),
    );
  }

  // An unauthenticated re-issue attempt is refused (401) before any pod IO —
  // the issuer rail never becomes a signing oracle.
  const anonymous = await fetch(`${origins.issuers}/issuers/api/issue`, {
    body: JSON.stringify({ flow: "org-identity" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(anonymous.status).toBe(401);

  // Mint the Tier A "sample owner" anchor — the ONE anchor the live issuers
  // app deliberately never mints in-process (needs the native sparq bridge,
  // unavailable here — see `support/kyb-fixtures.ts`'s header). Real
  // captured `filter_int_d4` encoding, never fabricated.
  const sampleAnchor = await mintSampleOwnerAnchor({
    issuer: beneficialOwnershipRegistrar,
    now: seededAt,
    podBase: northwindPodBase,
    podFetch: northwindAdmin.authFetch,
    statusIndex: 50,
    subject: northwind.webid,
  });
  await putTurtle(
    northwindAdmin.authFetch,
    `${northwindPodBase}${ANCHOR_POD_PATHS.ownershipSample.slice(1)}`,
    sampleAnchor.body,
  );

  // Grant bank-onboarding's service identity direct read on both ZK anchors
  // (vault's grant catalogue does not yet cover anchor resources — a
  // documented cross-app gap, `apps/bank-onboarding/lib/server/
  // pod-resources.ts`'s header) and make the three status lists + issuer
  // docs publicly readable (a real deployment's own posture — verifiers must
  // dereference them anonymously).
  await Promise.all([
    putAcl(
      northwindAdmin.authFetch,
      `${northwindPodBase}${ANCHOR_POD_PATHS.ownershipSample.slice(1)}`,
      directGrantAcl(
        `${northwindPodBase}${ANCHOR_POD_PATHS.ownershipSample.slice(1)}`,
        northwind.webid,
        [bankOnboardingService.webId],
      ),
    ),
    putAcl(
      northwindAdmin.authFetch,
      `${northwindPodBase}${ANCHOR_POD_PATHS.arrayCommitment.slice(1)}`,
      directGrantAcl(
        `${northwindPodBase}${ANCHOR_POD_PATHS.arrayCommitment.slice(1)}`,
        northwind.webid,
        [bankOnboardingService.webId],
      ),
    ),
    putAcl(
      northwindAdmin.authFetch,
      `${northwindPodBase}kyb/status/org-identity`,
      publicReadAcl(`${northwindPodBase}kyb/status/org-identity`, northwind.webid),
    ),
    putAcl(
      northwindAdmin.authFetch,
      `${northwindPodBase}kyb/status/beneficial-ownership`,
      publicReadAcl(`${northwindPodBase}kyb/status/beneficial-ownership`, northwind.webid),
    ),
    putAcl(
      northwindAdmin.authFetch,
      `${northwindPodBase}kyb/status/officer-authorization`,
      publicReadAcl(`${northwindPodBase}kyb/status/officer-authorization`, northwind.webid),
    ),
  ]);

  // Verify-on-view (scene 1's headline beat): the vault's OWN real
  // fail-closed verify chain, hit at the CORRECT basePath-prefixed URL
  // directly (see this file's header for the confirmed front-end gap the
  // page's own "Load + verify credentials" button cannot reach).
  await page.goto(`${origins.vault}/vault/credentials`);
  await acknowledgeInterstitial(page);
  await expectBannerVisible(page);
  await expectAxeClean(page);

  interface CredentialSummary {
    readonly id: string;
    readonly status: "valid" | "pending" | "expired" | "revoked";
    readonly errors: readonly string[];
  }
  const verifyOnView = await fetch(`${origins.vault}/vault/api/dev/credentials`);
  expect(verifyOnView.status, await verifyOnView.clone().text()).toBe(200);
  const verifyOnViewBody = (await verifyOnView.json()) as { credentials: CredentialSummary[] };
  expect(verifyOnViewBody.credentials).toHaveLength(3);
  for (const credential of verifyOnViewBody.credentials) {
    expect(credential.status, `${credential.id}: ${JSON.stringify(credential.errors)}`).toBe(
      "valid",
    );
  }

  // The tour shell is live and passes the same trust-frame checks.
  await page.goto(origins.tour);
  await acknowledgeInterstitial(page);
  await expectBannerVisible(page);
  await expectAxeClean(page);
});

test("scene 2: bank-onboarding APPROVES with real credentials and a real beneficial-ownership completeness ZK proof", async ({
  page,
}) => {
  test.setTimeout(PROVE_TIMEOUT);
  interface DecisionBody {
    readonly status: "opened" | "declined";
    readonly reasons: readonly string[];
    readonly checks: {
      readonly disclosedThresholdOwnerCount: number | undefined;
      readonly tierA: Record<string, boolean>;
      readonly tierB: Record<string, boolean>;
    };
  }
  interface ChallengeBody {
    readonly tierA: { readonly sessionKey: string; readonly nonce: string };
    readonly tierB: { readonly sessionKey: string; readonly nonce: string };
  }

  // Before any grant, an authenticated decision attempt reads a 401/403 from
  // the pod itself when reaching for ungranted credentials — proven via the
  // decision endpoint's own 401 for an ANONYMOUS caller first.
  const anonymousDecision = await fetch(
    `${origins.bankOnboarding}/bank-onboarding/api/kyb/decision`,
    {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  expect(anonymousDecision.status).toBe(401);

  // The wallet grants bank-onboarding EXACTLY the three catalogue
  // credentials — a REAL WAC transition through vault's real grant rail
  // (correct basePath-prefixed URL — see this file's header).
  for (const resource of ["orgIdentity", "beneficialOwnership", "officerAuthorization"] as const) {
    const response = await northwind.authFetch(`${origins.vault}/vault/api/grants/change`, {
      body: JSON.stringify({ action: "grant", party: "bank-onboarding", resource }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(
      response.status,
      `grant bank-onboarding/${resource}: ${await response.clone().text()}`,
    ).toBe(200);
  }

  const challengeResponse = await northwind.authFetch(
    `${origins.bankOnboarding}/bank-onboarding/api/kyb/challenge`,
    { method: "POST" },
  );
  expect(challengeResponse.status, await challengeResponse.clone().text()).toBe(200);
  const challenge = (await challengeResponse.json()) as ChallengeBody;

  const northwindBps = NORTHWIND.owners.map((owner) => owner.ownershipPercentageBps);
  const arrayCommitment = await ownershipArrayCommitment(northwindBps);

  const tierAProof: TierAProof = await proveOwnerThreshold({
    nonce: challenge.tierA.nonce,
    operandEnc: SAMPLE_OWNER_OPERAND_ENC,
    value: SAMPLE_OWNER_BPS,
  });
  // Two of Northwind's four owners (Jordan Blake 4200 bps, Priya Nandakumar
  // 2800 bps) are genuinely >= the 2500-bps threshold.
  const tierBProof = await proveCompleteness({
    arrayCommitment,
    bps: northwindBps,
    disclosedCount: 2,
    nonce: challenge.tierB.nonce,
  });

  const decisionResponse = await northwind.authFetch(
    `${origins.bankOnboarding}/bank-onboarding/api/kyb/decision`,
    {
      body: JSON.stringify({
        tierA: {
          nonce: challenge.tierA.nonce,
          proof: toWireProof(tierAProof),
          sessionKey: challenge.tierA.sessionKey,
        },
        tierB: {
          nonce: challenge.tierB.nonce,
          proof: toWireProof(tierBProof),
          sessionKey: challenge.tierB.sessionKey,
        },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  expect(decisionResponse.status, await decisionResponse.clone().text()).toBe(200);
  const decision = (await decisionResponse.json()) as DecisionBody;
  expect(decision.reasons, JSON.stringify(decision.reasons)).toEqual([]);
  expect(decision.status).toBe("opened");
  expect(decision.checks.disclosedThresholdOwnerCount).toBe(2);
  expect(
    Object.values(decision.checks.tierA).every(Boolean),
    JSON.stringify(decision.checks.tierA),
  ).toBe(true);
  expect(
    Object.values(decision.checks.tierB).every(Boolean),
    JSON.stringify(decision.checks.tierB),
  ).toBe(true);

  await page.goto(`${origins.bankOnboarding}/bank-onboarding`);
  await acknowledgeInterstitial(page);
  await expectBannerVisible(page);
  await expectAxeClean(page);
});

test("scene 3: a hidden >=25% beneficial owner is DECLINED — STATEMENT_MISMATCH from real data, never a mock", async () => {
  test.setTimeout(PROVE_TIMEOUT);
  interface DecisionBody {
    readonly status: "opened" | "declined";
    readonly reasons: readonly string[];
    readonly checks: {
      readonly disclosedThresholdOwnerCount: number | undefined;
      readonly tierB: Record<string, boolean>;
    };
  }
  interface ChallengeBody {
    readonly tierA: { readonly sessionKey: string; readonly nonce: string };
    readonly tierB: { readonly sessionKey: string; readonly nonce: string };
  }

  const challengeResponse = await variant.authFetch(
    `${origins.bankOnboarding}/bank-onboarding/api/kyb/challenge`,
    { method: "POST" },
  );
  expect(challengeResponse.status, await challengeResponse.clone().text()).toBe(200);
  const challenge = (await challengeResponse.json()) as ChallengeBody;

  const trueBps = [4200, 2800, 2600, 1200];
  const arrayCommitment = await ownershipArrayCommitment(trueBps);

  const tierAProof: TierAProof = await proveOwnerThreshold({
    nonce: challenge.tierA.nonce,
    operandEnc: SAMPLE_OWNER_OPERAND_ENC,
    value: SAMPLE_OWNER_BPS,
  });
  // The HONEST completeness proof over the TRUE anchored array can only be
  // produced for disclosedCount=3 (Jordan 4200, Priya 2800, Marcus's REAL
  // 2600 — all >= threshold). Presenting it therefore diverges from
  // bank-onboarding's OWN count, independently computed from the DISCLOSED
  // credential (which still shows Marcus at 1800, < threshold) — a real
  // STATEMENT_MISMATCH, not a client-side proving refusal.
  const tierBProof = await proveCompleteness({
    arrayCommitment,
    bps: trueBps,
    disclosedCount: 3,
    nonce: challenge.tierB.nonce,
  });

  const decisionResponse = await variant.authFetch(
    `${origins.bankOnboarding}/bank-onboarding/api/kyb/decision`,
    {
      body: JSON.stringify({
        tierA: {
          nonce: challenge.tierA.nonce,
          proof: toWireProof(tierAProof),
          sessionKey: challenge.tierA.sessionKey,
        },
        tierB: {
          nonce: challenge.tierB.nonce,
          proof: toWireProof(tierBProof),
          sessionKey: challenge.tierB.sessionKey,
        },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  expect(decisionResponse.status, await decisionResponse.clone().text()).toBe(200);
  const decision = (await decisionResponse.json()) as DecisionBody;
  expect(decision.status).toBe("declined");
  expect(decision.checks.disclosedThresholdOwnerCount).toBe(2);
  expect(decision.checks.tierB.statement).toBe(false);
  expect(
    decision.reasons.some((reason) => reason.includes("STATEMENT_MISMATCH")),
    JSON.stringify(decision.reasons),
  ).toBe(true);

  // separately: proveCompleteness itself REFUSES to produce a proof for a
  // DISHONEST understated count over the same hidden-owner array — the ZK
  // layer's own forgery-proofing, exercised directly (never a mock).
  await expect(
    proveCompleteness({
      arrayCommitment,
      bps: trueBps,
      disclosedCount: 2,
      nonce: "kyb-e2e-hidden-owner-prove-refusal",
    }),
  ).rejects.toMatchObject({ code: "UNSATISFIABLE" });
});

test("scene 4: bank-credit REUSES the same credentials with zero re-collection", async ({
  page,
}) => {
  interface DecisionBody {
    readonly claims: { readonly businessName: string; readonly owners: readonly unknown[] } | null;
    readonly decision: {
      readonly outcome: "approve" | "decline";
      readonly reasons: readonly string[];
    };
    readonly decisionIri: string;
  }

  const anonymous = await fetch(`${origins.bankCredit}/bank-credit/api/decision`, {
    method: "POST",
  });
  expect(anonymous.status).toBe(401);

  for (const resource of ["orgIdentity", "beneficialOwnership", "officerAuthorization"] as const) {
    const response = await northwind.authFetch(`${origins.vault}/vault/api/grants/change`, {
      body: JSON.stringify({ action: "grant", party: "bank-credit", resource }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status, `grant bank-credit/${resource}: ${await response.clone().text()}`).toBe(
      200,
    );
  }

  const decisionResponse = await northwind.authFetch(
    `${origins.bankCredit}/bank-credit/api/decision`,
    {
      method: "POST",
    },
  );
  expect(decisionResponse.status, await decisionResponse.clone().text()).toBe(200);
  const decision = (await decisionResponse.json()) as DecisionBody;
  expect(decision.decision.reasons, JSON.stringify(decision.decision.reasons)).toEqual([]);
  expect(decision.decision.outcome).toBe("approve");
  expect(decision.claims?.businessName).toBe(NORTHWIND.businessName);
  expect(decision.claims?.owners).toHaveLength(4);

  // The SAME underlying credential resources — no third copy was ever made.
  const orgIdentityIri = `${northwindPodBase}${RESOURCE_POD_PATHS["org-identity-credential"].slice(1)}`;
  expect(decision.decisionIri.startsWith(northwindPodBase)).toBe(true);
  const reread = await northwind.authFetch(orgIdentityIri);
  expect(reread.status).toBe(200);

  await page.goto(`${origins.bankCredit}/bank-credit`);
  await acknowledgeInterstitial(page);
  await expectBannerVisible(page);
  await expectAxeClean(page);
});

test("scene 5/6: revoking bank-onboarding's grant has REAL WAC effect, and the ledger reflects it", async ({
  page,
}) => {
  test.setTimeout(PROVE_TIMEOUT);
  interface GrantStanding {
    readonly agent: string;
    readonly resource: string;
    readonly granted: boolean;
    readonly revoked: boolean;
  }
  interface GrantsResponse {
    readonly standings: readonly GrantStanding[];
  }
  interface LedgerResponse {
    readonly receipts: readonly {
      readonly action: string;
      readonly recipient: string;
      readonly resource: string;
    }[];
  }
  interface ChallengeBody {
    readonly tierA: { readonly sessionKey: string; readonly nonce: string };
    readonly tierB: { readonly sessionKey: string; readonly nonce: string };
  }
  interface DecisionBody {
    readonly status: "opened" | "declined";
    readonly checks: {
      readonly beneficialOwnership: { readonly verified: boolean };
    };
  }

  const revokeResponse = await northwind.authFetch(`${origins.vault}/vault/api/grants/change`, {
    body: JSON.stringify({
      action: "revoke",
      party: "bank-onboarding",
      resource: "beneficialOwnership",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(revokeResponse.status, await revokeResponse.clone().text()).toBe(200);
  const revoked = (await revokeResponse.json()) as { receipt: { action: string } };
  expect(revoked.receipt.action).toBe("revoke");

  const standingsResponse = await northwind.authFetch(`${origins.vault}/vault/api/grants`);
  expect(standingsResponse.status).toBe(200);
  const standings = (await standingsResponse.json()) as GrantsResponse;
  const standing = standings.standings.find(
    (entry) =>
      entry.agent === bankOnboardingService.webId && entry.resource === "beneficialOwnership",
  );
  expect(standing?.granted).toBe(false);
  expect(standing?.revoked).toBe(true);

  // REAL WAC effect: bank-onboarding's own service identity can no longer
  // read the beneficial-ownership credential it needs — a fresh decision
  // round trip now DECLINES on that specific check (a genuinely different
  // nonce/proof pair; nonces are single-use).
  const challengeResponse = await northwind.authFetch(
    `${origins.bankOnboarding}/bank-onboarding/api/kyb/challenge`,
    { method: "POST" },
  );
  expect(challengeResponse.status).toBe(200);
  const challenge = (await challengeResponse.json()) as ChallengeBody;
  const northwindBps = NORTHWIND.owners.map((owner) => owner.ownershipPercentageBps);
  const arrayCommitment = await ownershipArrayCommitment(northwindBps);
  const tierAProof = await proveOwnerThreshold({
    nonce: challenge.tierA.nonce,
    operandEnc: SAMPLE_OWNER_OPERAND_ENC,
    value: SAMPLE_OWNER_BPS,
  });
  const tierBProof = await proveCompleteness({
    arrayCommitment,
    bps: northwindBps,
    disclosedCount: 2,
    nonce: challenge.tierB.nonce,
  });
  const postRevokeDecision = await northwind.authFetch(
    `${origins.bankOnboarding}/bank-onboarding/api/kyb/decision`,
    {
      body: JSON.stringify({
        tierA: {
          nonce: challenge.tierA.nonce,
          proof: toWireProof(tierAProof),
          sessionKey: challenge.tierA.sessionKey,
        },
        tierB: {
          nonce: challenge.tierB.nonce,
          proof: toWireProof(tierBProof),
          sessionKey: challenge.tierB.sessionKey,
        },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  expect(postRevokeDecision.status).toBe(200);
  const postRevokeBody = (await postRevokeDecision.json()) as DecisionBody;
  expect(postRevokeBody.status).toBe("declined");
  expect(postRevokeBody.checks.beneficialOwnership.verified).toBe(false);

  // The ledger — the vault's own real, integrity-locked receipt store —
  // shows the revoke.
  const ledgerResponse = await northwind.authFetch(`${origins.vault}/vault/api/ledger`);
  expect(ledgerResponse.status).toBe(200);
  const ledger = (await ledgerResponse.json()) as LedgerResponse;
  expect(
    ledger.receipts.some(
      (entry) =>
        entry.action === "revoke" &&
        entry.recipient === bankOnboardingService.webId &&
        entry.resource ===
          `${northwindPodBase}${RESOURCE_POD_PATHS["beneficial-ownership-credential"].slice(1)}`,
    ),
    JSON.stringify(ledger.receipts),
  ).toBe(true);

  // The trust-frame surface for the ledger (no client fetch is exercised
  // here, see this file's header).
  await page.goto(`${origins.vault}/vault/ledger`);
  await acknowledgeInterstitial(page);
  await expectBannerVisible(page);
  await expectAxeClean(page);

  // `/vault/grants` is DELIBERATELY NOT visited here: confirmed real
  // browser crash, unrelated to this journey's own seeding/auth — its
  // client bundle (`app/grants/page.tsx` -> `lib/grants/resources.ts` ->
  // `@kyb/data-model`) pulls in `packages/data-model/src/index.ts`'s
  // top-level `shapesDir = join(dirname(fileURLToPath(import.meta.url)),
  // ...)`, which unconditionally calls Node's `node:url`/`node:path`
  // builtins at MODULE-EVALUATION time. Turbopack ships a stub for
  // `fileURLToPath` in the browser bundle that is not callable, so the
  // page's client JS throws `TypeError: ... fileURLToPath is not a
  // function` on load — reproduced verbatim via this journey's real
  // Chromium page (`[browser] Uncaught TypeError ... packages/data-model/
  // src/index.ts:104`). A package-level fix (lazy/server-only `shapesDir`)
  // is out of this suite's e2e/* scope — flagged in the PR description
  // instead of silently skipped.
});
