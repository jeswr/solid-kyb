# Deploying the KYB walkthrough to Vercel

Deploy one Vercel project per app from this monorepo. Project names and public hostnames are
neutral and role-based; organisation names appear only in the walkthrough's explicit
"modelled on" copy.

## Project matrix

| App directory | Package | Vercel project | Production URL |
|---|---|---|---|
| `apps/vocab` | `@kyb/vocab` | `solid-kyb-vocab` | `https://solid-kyb-vocab.vercel.app` |
| `apps/vault` | `@kyb/app-vault` | `solid-kyb-vault` | `https://solid-kyb-vault.vercel.app` |
| `apps/issuers` | `@kyb/app-issuers` | `solid-kyb-issuers` | `https://solid-kyb-issuers.vercel.app` |
| `apps/bank-onboarding` | `@kyb/app-bank-onboarding` | `solid-kyb-bank-onboarding` | `https://solid-kyb-bank-onboarding.vercel.app` |
| `apps/bank-credit` | `@kyb/app-bank-credit` | `solid-kyb-bank-credit` | `https://solid-kyb-bank-credit.vercel.app` |
| `apps/tour` | `@kyb/app-tour` | `solid-kyb` | `https://solid-kyb.vercel.app` |

Deploy `solid-kyb-vocab` first. No other KYB app may go live until
`https://solid-kyb-vocab.vercel.app/kyb` dereferences as Turtle, JSON-LD, and HTML.

## Per-project settings

- `rootDirectory`: the matching `apps/<slug>` directory.
- `framework`: `nextjs`.
- `installCommand`: `pnpm install --frozen-lockfile`.
- `buildCommand` and `outputDirectory`: `null`. The checked-in `vercel.json` owns the build.
- Node.js: `24.x`.
- Vercel Authentication: `deploymentType: all_except_custom_domains`.

Deploy from a Git worktree root rather than an ordinary checkout. The account's Hobby seat blocks
deployments carrying an unrecognised Git commit author; a worktree's `.git` pointer avoids attaching
that metadata. Upload the whole monorepo so pnpm can resolve workspace and vendored dependencies.

## Environment matrix

Set these build-time variables on the `solid-kyb` tour project for Production and Preview, then
redeploy the tour after the zone projects have production URLs:

| Variable | Value |
|---|---|
| `KYB_VAULT_ZONE_URL` | `https://solid-kyb-vault.vercel.app` |
| `KYB_ISSUERS_ZONE_URL` | `https://solid-kyb-issuers.vercel.app` |
| `KYB_BANK_ONBOARDING_ZONE_URL` | `https://solid-kyb-bank-onboarding.vercel.app` |
| `KYB_BANK_CREDIT_ZONE_URL` | `https://solid-kyb-bank-credit.vercel.app` |

Set `KYB_TRUST_FORWARDED_HEADERS=1` for Production and Preview on `vault`, `issuers`,
`bank-onboarding`, and `bank-credit`.

Authenticated pod routes intentionally fail closed with HTTP 503 until a hosted Solid pod and the
following allowlists are configured on every pod-route project:

- `KYB_TRUSTED_OIDC_ISSUERS`
- `KYB_POD_ALLOWED_ORIGINS`

Do not use placeholder values. A browsable deployment is not the fully authenticated journey.

## Deployment order

1. Deploy `solid-kyb-vocab` and verify `/kyb` content negotiation.
2. Deploy the four zone projects.
3. Set the tour's four `KYB_*_ZONE_URL` values.
4. Deploy `solid-kyb` last so its rewrites bake in the production zone URLs.

## Verification

- Every deployment reaches Vercel `READY`.
- Each public production domain returns 200 at its app base path and its health endpoint returns
  `{"ok":true,...}`.
- Pages retain `noindex`, `robots.txt` disallows crawling, and the concept-demo disclaimer remains
  visible.
- `https://solid-kyb-vocab.vercel.app/kyb` returns source Turtle for `Accept: text/turtle`, JSON-LD
  for `Accept: application/ld+json`, and semantic HTML for browser requests.
- The tour's `/vault`, `/issuers`, `/bank-onboarding`, and `/bank-credit` paths render the zone apps
  rather than 404 responses.

Production `.vercel.app` domains are public on the Hobby plan. Vercel Authentication protects
preview/deployment aliases but not those production domains; the standing demo posture relies on
the consent interstitial, `noindex`, `robots.txt`, and explicit concept-demo disclaimers.
