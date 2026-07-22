import { decisionRail } from "../../../lib/server/service";

/** Scenes 3-4 — reuse the granted org-identity + beneficial-ownership credentials, verify them for real, and decide a business line of credit. */
export function POST(request: Request): Promise<Response> {
  return decisionRail().decide(request);
}
