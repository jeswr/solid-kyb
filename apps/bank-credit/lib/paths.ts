/**
 * The zone app's basePath (matches `next.config.ts`'s `basePath` and the
 * design §2.2 registry `path`: slug "bank-credit"). Client code must prefix
 * same-origin `fetch()` calls with this — unlike `next/link`/router
 * navigation, a plain `fetch()` is NOT automatically basePath-prefixed by
 * Next.
 */
export const BASE_PATH = "/bank-credit";
