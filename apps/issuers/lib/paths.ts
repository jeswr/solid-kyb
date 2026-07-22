/**
 * The zone app's basePath (matches `next.config.ts`'s `basePath` and the
 * design §2.2 registry `path` this app will register as "issuers" once
 * `apps/tour/content/walkthrough.json` exists). Client code must prefix
 * same-origin `fetch()` calls with this — unlike `next/link`/router
 * navigation, a plain `fetch()` is NOT automatically basePath-prefixed by
 * Next.
 */
export const BASE_PATH = "/issuers";
