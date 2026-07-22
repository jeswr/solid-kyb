import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  RequiredAs,
  RequiredFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { isValidIso17442Checksum } from "../lei.ts";
import { RDF_TYPE, SCHEMA } from "../vocab/external.ts";
import { KYB } from "../vocab/kyb.ts";

/**
 * Typed accessors over the shared support nodes the resource shapes
 * reference via `sh:node` (shapes/common.ttl). All construction and
 * mutation of these nodes goes through these wrappers — never hand-built
 * quads (house rule).
 *
 * Read discipline: pod RDF is untrusted input, so `validate()` the document
 * (with `expect` + `focusNode`) BEFORE wrapping it; the accessors then throw
 * descriptive errors on any residual malformation rather than guessing.
 */
export class TypedNode extends TermWrapper {
  /** `rdf:type` IRIs as a live, write-through set. */
  get typeIris(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
}

/** `schema:PostalAddress` (kybshape:PostalAddressShape — US-format fields). */
export class PostalAddress extends TypedNode {
  get streetAddress(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.streetAddress, LiteralAs.string);
  }
  set streetAddress(value: string) {
    RequiredAs.object(this, SCHEMA.streetAddress, value, LiteralFrom.string);
  }

  get addressLocality(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.addressLocality, LiteralAs.string);
  }
  set addressLocality(value: string) {
    RequiredAs.object(this, SCHEMA.addressLocality, value, LiteralFrom.string);
  }

  /** Two-letter US state code (shape-enforced pattern). */
  get addressRegion(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.addressRegion, LiteralAs.string);
  }
  set addressRegion(value: string) {
    RequiredAs.object(this, SCHEMA.addressRegion, value, LiteralFrom.string);
  }

  /** US ZIP or ZIP+4 (shape-enforced pattern). */
  get postalCode(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.postalCode, LiteralAs.string);
  }
  set postalCode(value: string) {
    RequiredAs.object(this, SCHEMA.postalCode, value, LiteralFrom.string);
  }
}

/**
 * `fibo-be-le-lei:LegalEntityIdentifier` (kybshape:LegalEntityIdentifierShape).
 * ALWAYS illustrative in this demo — `isIllustrativeLei` is fixed `true` by
 * the setter and cannot be unset, so an illustrative LEI can never be
 * silently mistaken for a real GLEIF-issued one (design §7, §9 open
 * question 3).
 */
export class LegalEntityIdentifier extends TypedNode {
  /** The ISO 17442 lexical form: 18 alphanumeric chars + 2-digit checksum. */
  get lei(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.identifier, LiteralAs.string);
  }
  set lei(value: string) {
    if (!/^[0-9A-Z]{18}[0-9]{2}$/.test(value)) {
      throw new RangeError(
        `lei must be the ISO 17442 lexical form (18 alphanumeric + 2-digit checksum), got ${JSON.stringify(value)}`,
      );
    }
    if (!isValidIso17442Checksum(value)) {
      throw new RangeError(`lei fails its ISO 7064 MOD 97-10 checksum: ${value}`);
    }
    RequiredAs.object(this, SCHEMA.identifier, value, LiteralFrom.string);
    RequiredAs.object(this, KYB.isIllustrativeLei, true, LiteralFrom.boolean);
  }

  /** Always `true` in this demo — illustrative, never a real GLEIF-issued LEI. */
  get isIllustrativeLei(): boolean {
    return RequiredFrom.subjectPredicate(this, KYB.isIllustrativeLei, LiteralAs.boolean);
  }
}
