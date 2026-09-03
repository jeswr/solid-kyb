import artifacts from "../../generated/vocab-artifacts.json";
import { negotiateVocabMediaType, VOCAB_MEDIA_TYPES } from "../../lib/negotiate";

export const dynamic = "force-dynamic";

const SHARED_HEADERS = {
  "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
  vary: "accept",
} as const;

const BODY_AND_HEADERS = {
  "text/turtle": {
    body: artifacts.turtle,
    headers: { "content-type": "text/turtle; charset=utf-8" },
  },
  "application/ld+json": {
    body: artifacts.jsonld,
    headers: { "content-type": "application/ld+json" },
  },
  "text/html": {
    body: artifacts.html,
    headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" },
  },
} as const;

/**
 * Serves the kyb hash namespace document. Every term IRI dereferences to this
 * document, with its fragment identifying the matching definition anchor.
 */
export function GET(request: Request): Response {
  const mediaType = negotiateVocabMediaType(request.headers.get("accept"));
  if (mediaType === undefined) {
    return new Response(`Not acceptable. Supported: ${VOCAB_MEDIA_TYPES.join(", ")}\n`, {
      status: 406,
      headers: { ...SHARED_HEADERS, "content-type": "text/plain; charset=utf-8" },
    });
  }
  const { body, headers } = BODY_AND_HEADERS[mediaType];
  return new Response(body, { status: 200, headers: { ...SHARED_HEADERS, ...headers } });
}
