import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { getGlobalDispatcher } from "undici";

const nativeFetch = globalThis.fetch;
const dispatcherUrl = new URL("./core/http-dispatcher.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
const sdk: unknown = await import(dispatcherUrl.href);
function dispatcherModule(value: unknown): value is { configureHttpDispatcher(timeoutMs: number): void } {
  return typeof value === "object" && value !== null && "configureHttpDispatcher" in value
    && typeof value.configureHttpDispatcher === "function";
}
assert.ok(dispatcherModule(sdk), "SDK dispatcher configuration export is missing");

const body = "offline SDK integrity fixture";
const digest = createHash("sha256").update(body).digest("base64");
const wrongDigest = createHash("sha256").update("different synthetic body").digest("base64");
let requests = 0;
const server = createServer((request, response) => {
  requests += 1;
  assert.equal(request.method, "GET");
  assert.equal(request.url, "/integrity-fixture");
  response.writeHead(200, { "content-type": "text/plain", "content-length": Buffer.byteLength(body) });
  response.end(body);
});

try {
  sdk.configureHttpDispatcher(5000);
  assert.notEqual(globalThis.fetch, nativeFetch, "SDK configuration must install npm Undici fetch, not leave Node's embedded fetch in use");
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/integrity-fixture`;
  await assert.rejects(fetch(url, { integrity: `\tsha256-${wrongDigest}` }), (error: unknown) =>
    error instanceof TypeError && error.cause instanceof Error && /integrity mismatch/i.test(error.cause.message));
  const response = await fetch(url, { integrity: `\tsha256-${digest}` });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), body);
  assert.equal(requests, 2);
  console.log("SDK dispatcher integrity fixture passed");
} finally {
  try {
    await getGlobalDispatcher().close();
  } finally {
    server.closeAllConnections();
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close(error => { if (error) reject(error); else resolve(); });
      });
    }
  }
}
