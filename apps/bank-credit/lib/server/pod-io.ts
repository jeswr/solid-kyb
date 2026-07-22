/**
 * Minimal pod-IO helpers this app's server routes need beyond what
 * `@jeswr/solid-pod-guard`'s PUBLIC surface exposes (its own read/write
 * helpers are internal to that package). Same fail-closed shape as the
 * sibling apps' equivalents (`pod_access` errors carry an explicit HTTP
 * status, never a silent default): a conditional-write-safe read/write pair
 * over an injected fetch (the service identity's, never anonymous). No RDF
 * parsing is needed for the reads that matter here — `verifyCredential`
 * parses the Turtle itself — so this module stays plain-text IO.
 */
import { PodAccessError } from "@jeswr/solid-pod-guard";

export type PodIoFetch = typeof fetch;

export interface PodTextResource {
  readonly text: string;
  readonly etag: string | null;
}

/** GET one pod Turtle resource as text over `podFetch`. 404 -> `undefined`; any other non-2xx throws. */
export async function readPodTurtle(
  iri: string,
  podFetch: PodIoFetch,
): Promise<PodTextResource | undefined> {
  let response: Response;
  try {
    response = await podFetch(iri, { headers: { accept: "text/turtle" }, redirect: "error" });
  } catch {
    throw new PodAccessError(502, `could not reach the pod for ${iri}`);
  }
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new PodAccessError(
      response.status === 401 || response.status === 403 ? response.status : 502,
      `pod read ${iri} failed: ${response.status}`,
    );
  }
  return { etag: response.headers.get("etag"), text: await response.text() };
}

/**
 * Conditional PUT of a Turtle document: `existing === undefined` (no prior
 * read found the resource) strict-creates (`If-None-Match: *`, so a lost
 * update racing a first write never silently clobbers); `existing` with a
 * known ETag replaces it (`If-Match`); `existing` with an unresolvable ETag
 * (host did not return one) writes without a precondition rather than
 * guessing wrong.
 */
export async function writePodTurtle(
  iri: string,
  turtle: string,
  options: { readonly existing: PodTextResource | undefined; readonly podFetch: PodIoFetch },
): Promise<void> {
  const headers: Record<string, string> = { "content-type": "text/turtle" };
  if (options.existing === undefined) {
    headers["if-none-match"] = "*";
  } else if (options.existing.etag !== null) {
    headers["if-match"] = options.existing.etag;
  }
  let response: Response;
  try {
    response = await options.podFetch(iri, {
      body: turtle,
      headers,
      method: "PUT",
      redirect: "error",
    });
  } catch {
    throw new PodAccessError(502, `could not write to the pod at ${iri}`);
  }
  if (!response.ok) {
    throw new PodAccessError(
      response.status === 401 || response.status === 403 ? response.status : 502,
      `pod write ${iri} failed: ${response.status}`,
    );
  }
}
