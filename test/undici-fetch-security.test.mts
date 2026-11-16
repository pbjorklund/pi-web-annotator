import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";
import test, { type TestContext } from "node:test";
import { Agent, fetch, Request, request, interceptors } from "undici";

// Public API regressions for https://github.com/nodejs/undici/releases/tag/v8.12.4.
// Owned loopback servers only: no global dispatcher/install or live credentials.
async function listen(t: TestContext, handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

const payload = "synthetic integrity fixture";
const digest = (algorithm: string, value: string): string => `${algorithm}-${createHash(algorithm).update(value).digest("base64")}`;
const whitespace = [" ", "\t", "\n", "\f", "\r"];
const integrityError = (error: unknown): boolean => error instanceof TypeError && error.cause instanceof Error && /integrity mismatch/.test(error.cause.message);

test("Undici SRI rejects wrong digests surrounded by every ASCII whitespace", async t => {
  const origin = await listen(t, (_req, res) => res.end(payload));
  const dispatcher = new Agent();
  t.after(() => dispatcher.close());
  for (const algorithm of ["sha256", "sha384", "sha512"]) {
    for (const separator of whitespace) {
      for (const integrity of [separator + digest(algorithm, "wrong"), digest(algorithm, "wrong") + separator]) {
        await assert.rejects(fetch(origin, { integrity, dispatcher }), integrityError, JSON.stringify({ algorithm, integrity }));
      }
    }
  }
});

test("Undici SRI uses the strongest whitespace-separated digest with fetch and Request", async t => {
  const origin = await listen(t, (_req, res) => res.end(payload));
  const dispatcher = new Agent();
  t.after(() => dispatcher.close());
  for (const separator of whitespace) {
    const integrity = digest("sha256", payload) + separator + digest("sha512", "wrong");
    await assert.rejects(fetch(new Request(origin, { integrity }), { dispatcher }), integrityError, JSON.stringify(separator));
  }
});

test("Undici SRI preserves correct digests, no integrity and unsupported-only metadata", async t => {
  const origin = await listen(t, (_req, res) => res.end(payload));
  const dispatcher = new Agent();
  t.after(() => dispatcher.close());
  for (const algorithm of ["sha256", "sha384", "sha512"]) {
    for (const separator of whitespace) {
      const integrity = separator + digest(algorithm, payload) + separator;
      assert.equal(await (await fetch(origin, { integrity, dispatcher })).text(), payload);
    }
  }
  for (const integrity of ["", "unsupported-synthetic"]) {
    assert.equal(await (await fetch(origin, { integrity, dispatcher })).text(), payload);
  }
});

test("Undici cross-origin tuple redirects strip standard credentials after header normalization", async t => {
  const received: { authorization: string | undefined; cookie: string | undefined; proxy: string | string[] | undefined; key: string | string[] | undefined; keep: string | string[] | undefined }[] = [];
  const target = await listen(t, (req, res) => {
    received.push({ authorization: req.headers.authorization, cookie: req.headers.cookie, proxy: req.headers["proxy-authorization"], key: req.headers["x-api-key"], keep: req.headers["x-keep"] });
    res.end("redirected fixture");
  });
  const sourceHeaders: string[] = [];
  const origin = await listen(t, (req, res) => {
    sourceHeaders.push(req.headers.authorization ?? "absent");
    res.writeHead(302, { location: target });
    res.end();
  });
  const headers: [string, string][] = [["Authorization", "synthetic"], ["Cookie", "fixture=user"], ["Proxy-Authorization", "synthetic"], ["X-Api-Key", "synthetic"], ["X-Keep", "present"]];
  const variants: (Record<string, string> | string[] | [string, string][])[] = [Object.fromEntries(headers), headers.flat(), headers];
  for (const normalizer of [interceptors.cache(), interceptors.deduplicate()]) {
    const dispatcher = new Agent().compose([normalizer, interceptors.redirect({ maxRedirections: 1 })]);
    t.after(() => dispatcher.close());
    for (const variant of variants) {
      assert.equal(await (await request(origin, { dispatcher, headers: variant })).body.text(), "redirected fixture");
    }
  }
  assert.deepEqual(sourceHeaders, Array.from({ length: 6 }, () => "synthetic"));
  assert.deepEqual(received, Array.from({ length: 6 }, () => ({ authorization: undefined, cookie: undefined, proxy: undefined, key: "synthetic", keep: "present" })));
});

test("Undici same-origin tuple redirects retain legitimate credentials", async t => {
  const received: (string | string[] | undefined)[][] = [];
  const origin = await listen(t, (req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/target" });
    } else {
      received.push([req.headers.authorization, req.headers.cookie, req.headers["proxy-authorization"], req.headers["x-api-key"], req.headers["x-keep"]]);
    }
    res.end("same-origin fixture");
  });
  const headers: [string, string][] = [["Authorization", "synthetic"], ["Cookie", "fixture=user"], ["Proxy-Authorization", "synthetic"], ["X-Api-Key", "synthetic"], ["X-Keep", "present"]];
  const dispatcher = new Agent().compose([interceptors.cache(), interceptors.redirect({ maxRedirections: 1 })]);
  t.after(() => dispatcher.close());
  assert.equal(await (await request(origin + "/redirect", { dispatcher, headers })).body.text(), "same-origin fixture");
  assert.deepEqual(received, [["synthetic", "fixture=user", "synthetic", "synthetic", "present"]]);
});
