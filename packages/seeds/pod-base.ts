/**
 * Normalize a pod base URL: PRESERVE any storage-root path (pods are not always
 * origin-rooted — `https://host/northwind/` is a valid pod base) and end with exactly one
 * trailing slash. Shared by `./issuance.ts` and `./kyb-pod.ts` so both agree on the same
 * pod-root-relative -> absolute IRI resolution. Ported from the sibling `jeswr/solid-lending`
 * seeder's identical helper (`seeds/pod-base.ts`, read-only reference).
 */
export function normalizedPodBase(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error(`pod base URL must not carry credentials, a query, or a fragment: ${baseUrl}`);
  }
  url.pathname = url.pathname.replace(/\/*$/, "/");
  return url.href;
}
