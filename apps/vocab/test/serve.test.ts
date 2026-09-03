import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";

const APP_ROOT = path.resolve(import.meta.dirname, "..");
const VOCAB_TTL = path.resolve(APP_ROOT, "..", "..", "packages", "data-model", "vocab", "kyb.ttl");
const require = createRequire(import.meta.url);

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("could not allocate a port"));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

let child: ChildProcess | undefined;
let baseUrl = "";

beforeAll(async () => {
  if (!existsSync(path.join(APP_ROOT, ".next"))) {
    throw new Error("production build missing - run `pnpm run build` for @kyb/vocab first");
  }
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.join(path.dirname(require.resolve("next/package.json")), "dist/bin/next");
  child = spawn(process.execPath, [nextBin, "start", "--port", String(port)], {
    cwd: APP_ROOT,
    stdio: "ignore",
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/kyb`, { headers: { accept: "text/turtle" } });
      if (response.ok) return;
    } catch {
      // Server not ready yet.
    }
    if (Date.now() > deadline) throw new Error("next start did not become ready within 60s");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
}, 90_000);

afterAll(() => {
  child?.kill("SIGTERM");
});

test("serves source Turtle verbatim", async () => {
  const response = await fetch(`${baseUrl}/kyb`, { headers: { accept: "text/turtle" } });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/turtle; charset=utf-8");
  expect(response.headers.get("vary")?.toLowerCase()).toContain("accept");
  expect(await response.text()).toBe(await readFile(VOCAB_TTL, "utf8"));
});

test("serves compacted JSON-LD", async () => {
  const response = await fetch(`${baseUrl}/kyb`, {
    headers: { accept: "application/ld+json" },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/ld+json");
  const document = JSON.parse(await response.text());
  expect(document["@context"].kyb).toBe("https://solid-kyb-vocab.vercel.app/kyb#");
  expect(JSON.stringify(document)).toContain("kyb:ZkOperandAnchor");
});

test("serves semantic browser documentation", async () => {
  const response = await fetch(`${baseUrl}/kyb`, {
    headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(response.headers.get("x-robots-tag")).toBe("noindex");
  const html = await response.text();
  expect(html).toContain('id="ZkOperandAnchor"');
  expect(html).toContain("kyb:ownershipPercentageBps");
  expect(html).toContain("<caption>KYB residue vocabulary term definitions</caption>");
});

test("returns 406 for unsupportable Accept headers", async () => {
  const response = await fetch(`${baseUrl}/kyb`, { headers: { accept: "image/png" } });
  expect(response.status).toBe(406);
  expect(await response.text()).toContain("text/turtle");
});

test("redirects the root path to /kyb", async () => {
  const response = await fetch(`${baseUrl}/`, { redirect: "manual" });
  expect([307, 308]).toContain(response.status);
  expect(response.headers.get("location")).toContain("/kyb");
});
