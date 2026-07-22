/**
 * ISO 17442 LEI lexical-form + checksum helpers (design §9 open question 3:
 * "fictional-LEI representation"). This demo never carries a real
 * GLEIF-issued LEI, but the fictional identifiers it does carry are still
 * ISO-17442-SHAPED and checksum-valid — they just use the LOU prefix "9999",
 * which GLEIF has never accredited to any Local Operating Unit, so the value
 * can never be confused with (or collide with) a real LEI. Every credential
 * carrying one also sets `kyb:isIllustrativeLei true` (support.ts).
 *
 * Checksum algorithm: ISO 7064 MOD 97-10, the same check digit scheme ISO
 * 17442 itself specifies (verified against a real, published LEI — GLEIF's
 * own worked example — in test/lei.test.ts).
 */

/** The LOU (Local Operating Unit) prefix this demo's fictional LEIs use. Never GLEIF-accredited. */
export const ILLUSTRATIVE_LOU_PREFIX = "9999";

function iso7064Mod9710(numeralString: string): bigint {
  let remainder = 0n;
  for (const digit of numeralString) {
    remainder = (remainder * 10n + BigInt(digit)) % 97n;
  }
  return remainder;
}

/** Letters A-Z map to 10-35 per ISO 7064's alphanumeric-to-numeral conversion. */
function toNumeralString(alphanumeric: string): string {
  let numerals = "";
  for (const char of alphanumeric) {
    if (/[0-9]/.test(char)) {
      numerals += char;
    } else if (/[A-Z]/.test(char)) {
      numerals += (char.charCodeAt(0) - 55).toString();
    } else {
      throw new RangeError(`toNumeralString: not an uppercase-alphanumeric character: ${char}`);
    }
  }
  return numerals;
}

/**
 * Computes the 2-digit ISO 7064 MOD 97-10 checksum for an 18-character LEI
 * base (4-char LOU prefix + 14-char entity-specific part, both
 * uppercase-alphanumeric).
 */
export function computeIso17442Checksum(base18: string): string {
  if (!/^[0-9A-Z]{18}$/.test(base18)) {
    throw new RangeError(
      `computeIso17442Checksum: base must be 18 uppercase-alphanumeric characters, got ${JSON.stringify(base18)}`,
    );
  }
  const remainder = iso7064Mod9710(`${toNumeralString(base18)}00`);
  return (98n - remainder).toString().padStart(2, "0");
}

/** True when a full 20-character LEI's checksum (chars 19-20) is ISO 7064 MOD 97-10 valid. */
export function isValidIso17442Checksum(lei: string): boolean {
  if (!/^[0-9A-Z]{18}[0-9]{2}$/.test(lei)) return false;
  return iso7064Mod9710(toNumeralString(lei)) === 1n;
}

/**
 * Builds an obviously-illustrative, checksum-valid fictional LEI: the
 * unaccredited "9999" LOU prefix plus a 14-character entity-specific stem
 * (padded/truncated to fit) and a computed ISO 7064 checksum.
 */
export function buildIllustrativeLei(entityStem: string): string {
  const normalized = entityStem.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const stem = normalized.slice(0, 14).padEnd(14, "0");
  const base18 = `${ILLUSTRATIVE_LOU_PREFIX}${stem}`;
  return `${base18}${computeIso17442Checksum(base18)}`;
}
