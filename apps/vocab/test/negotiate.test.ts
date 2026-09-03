import { expect, test } from "vitest";
import { negotiateVocabMediaType, VOCAB_MEDIA_TYPES } from "../lib/negotiate";

test("browser Accept header negotiates HTML", () => {
  expect(
    negotiateVocabMediaType(
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8",
    ),
  ).toBe("text/html");
});

test("explicit Turtle wins", () => {
  expect(negotiateVocabMediaType("text/turtle")).toBe("text/turtle");
});

test("explicit JSON-LD wins", () => {
  expect(negotiateVocabMediaType("application/ld+json")).toBe("application/ld+json");
});

test("q-values order the choice", () => {
  expect(negotiateVocabMediaType("application/ld+json;q=0.9, text/html;q=0.1")).toBe(
    "application/ld+json",
  );
});

test("absent and wildcard Accept headers fall back to canonical Turtle", () => {
  expect(negotiateVocabMediaType(null)).toBe("text/turtle");
  expect(negotiateVocabMediaType("*/*")).toBe("text/turtle");
});

test("unsupported media types negotiate nothing", () => {
  expect(negotiateVocabMediaType("image/png")).toBeUndefined();
});

test("the advertised media type list is stable", () => {
  expect([...VOCAB_MEDIA_TYPES]).toEqual(["text/turtle", "text/html", "application/ld+json"]);
});
