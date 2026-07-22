/**
 * ISO 17442/7064 fictional-LEI gates (design §9 open question 3). Every
 * fictional LEI in this repo must be lexically ISO-17442-shaped AND
 * checksum-valid — never a shape that merely LOOKS plausible.
 */
import { expect, test } from "vitest";
import {
  buildIllustrativeLei,
  computeIso17442Checksum,
  ILLUSTRATIVE_LOU_PREFIX,
  isValidIso17442Checksum,
} from "../src/lei.ts";

test("a real, published LEI (GLEIF's own worked example) validates against our checksum implementation", () => {
  // Apple Inc.'s LEI, widely published by GLEIF as a worked example.
  expect(isValidIso17442Checksum("HWUPKR0MPOU8FGXBT394")).toBe(true);
});

test("buildIllustrativeLei produces a checksum-valid, ISO-17442-shaped, never-accredited LEI", () => {
  const lei = buildIllustrativeLei("NWLOGISTICS001");
  expect(lei).toHaveLength(20);
  expect(lei).toMatch(/^[0-9A-Z]{18}[0-9]{2}$/);
  expect(lei.startsWith(ILLUSTRATIVE_LOU_PREFIX)).toBe(true);
  expect(isValidIso17442Checksum(lei)).toBe(true);
});

test("buildIllustrativeLei is deterministic and pads/truncates the entity stem to 14 characters", () => {
  expect(buildIllustrativeLei("NWLOGISTICS001")).toBe(buildIllustrativeLei("NWLOGISTICS001"));
  const short = buildIllustrativeLei("AB");
  expect(short).toHaveLength(20);
  expect(isValidIso17442Checksum(short)).toBe(true);
});

test("computeIso17442Checksum rejects a base that is not 18 uppercase-alphanumeric characters", () => {
  expect(() => computeIso17442Checksum("tooshort")).toThrow(/18 uppercase-alphanumeric/);
});

test("a corrupted checksum fails validation", () => {
  const lei = buildIllustrativeLei("NWLOGISTICS001");
  const validChecksum = lei.slice(18);
  const corruptedChecksum = validChecksum === "00" ? "01" : "00";
  expect(isValidIso17442Checksum(`${lei.slice(0, 18)}${corruptedChecksum}`)).toBe(false);
});
