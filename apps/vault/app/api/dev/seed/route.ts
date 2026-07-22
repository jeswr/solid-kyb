import {
  DevSeedUnavailableError,
  DevSeedUnconfiguredError,
  runDevSeed,
} from "../../../../lib/server/dev-seed";

/**
 * The vault's dev-gated "Mode-1" seed endpoint: seeds Northwind Logistics LLC's real signed
 * KYB-credential pod, triggered from the browser page at `/dev/seed`. Fails closed: 404
 * outside development, 503 while the seed target is unconfigured — never picks a default
 * pod.
 */
export async function POST(): Promise<Response> {
  try {
    const seeded = await runDevSeed();
    return Response.json({
      webid: seeded.webid,
      resources: seeded.resources.map((resource) => resource.path),
    });
  } catch (error) {
    if (error instanceof DevSeedUnavailableError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof DevSeedUnconfiguredError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}
