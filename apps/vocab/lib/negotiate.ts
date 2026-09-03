import Negotiator from "negotiator";

/** Turtle is canonical, browsers receive HTML, and JSON-LD is available explicitly. */
export const VOCAB_MEDIA_TYPES = ["text/turtle", "text/html", "application/ld+json"] as const;

export type VocabMediaType = (typeof VOCAB_MEDIA_TYPES)[number];

export function negotiateVocabMediaType(acceptHeader: string | null): VocabMediaType | undefined {
  const negotiator = new Negotiator({
    headers: acceptHeader === null ? {} : { accept: acceptHeader },
  });
  return negotiator.mediaType([...VOCAB_MEDIA_TYPES]) as VocabMediaType | undefined;
}
