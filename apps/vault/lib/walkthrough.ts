/**
 * Single-sourced registry data: this app's name, theme, modelled-on framing, and honesty
 * content all come from a `parseWalkthrough`-validated document — the SAME mechanism the
 * eventual `tour` shell will render from (design §2.2/§6), owned locally here because that
 * shell does not exist yet in this build round. When `apps/tour` lands, its
 * `content/walkthrough.json` should absorb this document's registry/chapters/compliance
 * content and this file should import from it instead (mirrors the pattern
 * `jeswr/solid-lending`'s wallet app already uses once its own tour ships).
 */
import walkthroughJson from "../content/walkthrough.json" with { type: "json" };
import { parseWalkthrough, registeredApp } from "@jeswr/solid-showcase";

export const walkthrough = parseWalkthrough(walkthroughJson);
export const app = registeredApp(walkthrough.registry, "vault");
