import assert from "node:assert/strict";
import { finished } from "node:stream/promises";
import { MockAgent, cacheStores, interceptors } from "undici";
type CacheOptions = NonNullable<Parameters<typeof interceptors.cache>[0]>;
type CacheStore = NonNullable<CacheOptions["store"]>;

const mode = process.argv[2];
assert.ok(mode === "dump" || mode === "async-get");
const mock = new MockAgent();
mock.disableNetConnect();
const origin = "http://replay-fixture.invalid";
const memory = new cacheStores.MemoryCacheStore();
let stored: Promise<void> | undefined;
const store: CacheStore = {
  get: key => memory.get(key),
  createWriteStream: (key, value) => {
    const stream = memory.createWriteStream(key, value);
    assert.ok(stream);
    stored = finished(stream);
    return stream;
  },
  delete: key => memory.delete(key),
};
let hits = 0;
mock.get(origin).intercept({ path: "/body" }).reply(() => {
  hits++;
  return { statusCode: 200, data: "x".repeat(64), responseOptions: { headers: { "cache-control": "public, max-age=600" } } };
}).persist();
const cached = mock.compose(interceptors.cache({ store }));
const options = { origin, path: "/body", method: "GET" } satisfies Parameters<typeof cached.request>[0];
try {
  assert.equal(await (await cached.request(options)).body.text(), "x".repeat(64));
  assert.ok(stored);
  await stored;
  assert.ok(await store.get({ origin, path: "/body", method: "GET" }));
  assert.equal(await (await cached.request(options)).body.text(), "x".repeat(64));
  assert.equal(hits, 1, "ordinary replay must actually hit the cache");
  if (mode === "dump") {
    const replay = mock.compose(interceptors.cache({ store }), interceptors.dump({ maxSize: 8 }));
    await assert.rejects(async () => {
      const response = await replay.request(options);
      await response.body.text();
    }, { code: "UND_ERR_ABORTED", message: /larger than maxSize/ });
  } else {
    let gets = 0;
    const failing: CacheStore = {
      get: () => { gets++; return Promise.reject(new Error("synthetic cache unavailable")); },
      createWriteStream: () => { assert.fail("failing get must not write"); },
      delete: () => {},
    };
    const replay = mock.compose(interceptors.cache({ store: failing }));
    await assert.rejects(replay.request(options), { message: "synthetic cache unavailable" });
    assert.equal(gets, 1);
  }
  assert.equal(hits, 1, "error path must not silently fall back to the origin");
} finally { await mock.close(); }
console.log(`replay-ok:${mode}`);
