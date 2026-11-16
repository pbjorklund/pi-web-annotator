import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { finished } from "node:stream/promises";
import test from "node:test";
import { promisify } from "node:util";
import { MockAgent, cacheStores, interceptors } from "undici";

const policy = { "cache-control": "public, max-age=600" };
const origin = "http://cache-fixture.invalid";

function client() {
  const mock = new MockAgent();
  mock.disableNetConnect();
  const dispatcher = mock.compose(
    interceptors.redirect({ maxRedirections: 4 }),
    interceptors.cache({ store: new cacheStores.MemoryCacheStore(), type: "shared" }),
  );
  const get = async (path: string, headers?: Record<string, string>) => {
    const response = await dispatcher.request({ origin, path, method: "GET", headers });
    return { status: response.statusCode, body: await response.body.text() };
  };
  return { mock, get };
}

// GHSA-mqg3: checking only the final origin misses an A -> B -> A bounce.
test("GHSA-mqg3: a cross-origin bounce cannot poison the original alias", { timeout: 5000 }, async () => {
  const { mock, get } = client();
  let enabled = true;
  const hits = { alias: 0, bounce: 0, payload: 0 };
  mock.get(origin).intercept({ path: "/alias" }).reply(() => {
    hits.alias++;
    return enabled
      ? { statusCode: 302, data: "", responseOptions: { headers: { ...policy, location: "http://bounce-fixture.invalid/bounce" } } }
      : { statusCode: 200, data: "legitimate", responseOptions: { headers: { "cache-control": "no-store" } } };
  }).persist();
  mock.get("http://bounce-fixture.invalid").intercept({ path: "/bounce" }).reply(() => {
    hits.bounce++;
    return { statusCode: 302, data: "", responseOptions: { headers: { ...policy, location: `${origin}/payload` } } };
  }).persist();
  mock.get(origin).intercept({ path: "/payload" }).reply(() => {
    hits.payload++;
    return { statusCode: 200, data: "bounced-bytes", responseOptions: { headers: policy } };
  }).persist();
  try {
    assert.equal((await get("/alias")).body, "bounced-bytes");
    assert.deepEqual(hits, { alias: 1, bounce: 1, payload: 1 });
    enabled = false;
    assert.equal((await get("/alias")).body, "legitimate");
    assert.deepEqual(hits, { alias: 2, bounce: 1, payload: 1 });
  } finally { await mock.close(); }
});

for (const restrictive of [true, false]) {
  test(`GHSA-mqg3: ${restrictive ? "intermediate no-store prevents" : "explicit public same-origin redirects permit"} alias caching`, { timeout: 5000 }, async () => {
    const { mock, get } = client();
    const hits = { alias: 0, middle: 0, target: 0 };
    mock.get(origin).intercept({ path: "/alias" }).reply(() => {
      hits.alias++;
      return { statusCode: 302, data: "", responseOptions: { headers: { ...policy, location: "/middle" } } };
    }).persist();
    mock.get(origin).intercept({ path: "/middle" }).reply(() => {
      hits.middle++;
      return { statusCode: 302, data: "", responseOptions: { headers: { "cache-control": restrictive ? "no-store" : "public, max-age=600", location: "/target" } } };
    }).persist();
    mock.get(origin).intercept({ path: "/target" }).reply(() => {
      hits.target++;
      return { statusCode: 200, data: "public-target", responseOptions: { headers: policy } };
    }).persist();
    try {
      assert.equal((await get("/alias")).body, "public-target");
      assert.deepEqual(hits, { alias: 1, middle: 1, target: 1 });
      assert.equal((await get("/alias")).body, "public-target");
      assert.deepEqual(hits, restrictive ? { alias: 2, middle: 2, target: 2 } : { alias: 1, middle: 1, target: 1 });
    } finally { await mock.close(); }
  });
}

test("GHSA-mqg3: intermediate Vary separates otherwise cacheable aliases", async () => {
  const { mock, get } = client();
  const hits = { a: 0, b: 0 };
  for (const variant of ["a", "b"] as const) {
    mock.get(origin).intercept({ path: "/vary", headers: { "x-variant": variant } }).reply(() => {
      hits[variant]++;
      return { statusCode: 302, data: "", responseOptions: { headers: { ...policy, vary: "x-variant", location: `/variant-${variant}` } } };
    }).persist();
    mock.get(origin).intercept({ path: `/variant-${variant}` }).reply(200, variant, { headers: policy }).persist();
  }
  try {
    assert.equal((await get("/vary", { "x-variant": "a" })).body, "a");
    assert.equal((await get("/vary", { "x-variant": "a" })).body, "a");
    assert.deepEqual(hits, { a: 1, b: 0 }, "same variant must actually cache");
    assert.equal((await get("/vary", { "x-variant": "b" })).body, "b");
    assert.deepEqual(hits, { a: 1, b: 1 });
  } finally { await mock.close(); }
});

test("GHSA-mqg3: an exhausted intermediate freshness limit beats the final response lifetime", async () => {
  const { mock, get } = client();
  let hits = 0;
  mock.get(origin).intercept({ path: "/expired-hop" }).reply(() => {
    hits++;
    return hits === 1
      ? { statusCode: 302, data: "", responseOptions: { headers: { "cache-control": "public, max-age=0", age: "1", location: "/long-lived" } } }
      : { statusCode: 200, data: "current-origin", responseOptions: { headers: { "cache-control": "no-store" } } };
  }).persist();
  mock.get(origin).intercept({ path: "/long-lived" }).reply(200, "old-final", { headers: policy });
  try {
    assert.equal((await get("/expired-hop")).body, "old-final");
    assert.equal((await get("/expired-hop")).body, "current-origin");
    assert.equal(hits, 2);
  } finally { await mock.close(); }
});

for (const credential of ["authorization", "cookie", "proxy-authorization"]) {
  test(`GHSA-7xg3: ${credential} redirects do not share principal aliases`, { timeout: 5000 }, async () => {
    const { mock, get } = client();
    let aliasHits = 0;
    let profileHits = 0;
    for (const principal of ["alice", "bob", "anonymous"]) {
      mock.get(origin).intercept({ path: "/me", headers: principal === "anonymous" ? undefined : { [credential]: principal } }).reply(() => {
        aliasHits++;
        return { statusCode: 302, data: "", responseOptions: { headers: { ...policy, location: `/profile/${principal}` } } };
      });
      mock.get(origin).intercept({ path: `/profile/${principal}` }).reply(() => {
        profileHits++;
        return { statusCode: 200, data: `profile:${principal}`, responseOptions: { headers: policy } };
      });
    }
    try {
      for (const principal of ["alice", "bob", "anonymous"]) {
        const headers = principal === "anonymous" ? undefined : { [credential]: principal };
        assert.equal((await get("/me", headers)).body, `profile:${principal}`);
      }
      assert.equal(aliasHits, 3);
      assert.equal(profileHits, 3);
      mock.assertNoPendingInterceptors();
    } finally { await mock.close(); }
  });
}

for (const redirects of [true, false]) {
  test(`GHSA-5rm8: ${redirects ? "cross-origin 304 retries without the old validator" : "same-resource matching 304 preserves reusable cached bytes"}`, { timeout: 5000 }, async () => {
    const { mock, get } = client();
    const validators: (string | string[] | undefined)[] = [];
    let sourceHits = 0;
    mock.get(origin).intercept({ path: "/stale" }).reply(() => {
      sourceHits++;
      return { statusCode: 200, data: "oldbody", responseOptions: { headers: { "cache-control": "public, max-age=0, must-revalidate", age: "1", etag: '"oldtag"' } } };
    });
    if (redirects) {
      mock.get(origin).intercept({ path: "/stale" }).reply(() => {
        sourceHits++;
        return { statusCode: 302, data: "", responseOptions: { headers: { location: "http://validator-fixture.invalid/target", "cache-control": "no-store" } } };
      }).persist();
    }
    mock.get(redirects ? "http://validator-fixture.invalid" : origin).intercept({ path: redirects ? "/target" : "/stale" }).reply(options => {
      const headers = options.headers;
      let validator: unknown;
      if (Array.isArray(headers)) {
        const index = headers.findIndex(value => typeof value === "string" && value.toLowerCase() === "if-none-match");
        validator = index < 0 ? undefined : headers[index + 1];
      } else {
        validator = typeof headers === "object" && headers !== null && "if-none-match" in headers ? headers["if-none-match"] : undefined;
      }
      assert.ok(validator === undefined || typeof validator === "string");
      validators.push(validator);
      if (!redirects) sourceHits++;
      return validator
        ? { statusCode: 304, data: "", responseOptions: { headers: { etag: '"oldtag"' } } }
        : { statusCode: 200, data: "target200", responseOptions: { headers: { "cache-control": "no-store" } } };
    }).persist();
    try {
      assert.equal((await get("/stale")).body, "oldbody");
      assert.deepEqual(await get("/stale"), { status: 200, body: redirects ? "target200" : "oldbody" });
      assert.deepEqual(validators, redirects ? ['"oldtag"', undefined] : ['"oldtag"']);
      assert.equal(sourceHits, redirects ? 3 : 2);
      if (!redirects) {
        assert.equal((await get("/stale")).body, "oldbody");
        assert.equal(sourceHits, 3);
        assert.deepEqual(validators, ['"oldtag"', '"oldtag"']);
      }
    } finally { await mock.close(); }
  });
}

test("GHSA-mqg3: previous SQLite schema entries are invalidated while fresh writes survive reopening", { timeout: 5000 }, async () => {
  const metadata: unknown = createRequire(import.meta.url)("undici/package.json");
  assert.ok(metadata && typeof metadata === "object" && "version" in metadata && typeof metadata.version === "string");
  const major = Number(metadata.version.split(".")[0]);
  assert.ok(major === 7 || major === 8);
  const previousSchema = major === 7 ? 3 : 4;
  const currentSchema = previousSchema + 1;
  const directory = await mkdtemp(join(tmpdir(), "undici-cache-security-"));
  const location = join(directory, "cache.sqlite");
  const key = { origin, path: "/persisted", method: "GET" };
  const now = Date.now();
  const db = new DatabaseSync(location);
  try {
    db.exec(`CREATE TABLE cacheInterceptorV${previousSchema} (
      id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, method TEXT NOT NULL,
      body BLOB, compressed TEXT, deleteAt INTEGER NOT NULL, statusCode INTEGER NOT NULL,
      statusMessage TEXT NOT NULL, headers TEXT, cacheControlDirectives TEXT, etag TEXT,
      vary TEXT, cachedAt INTEGER NOT NULL, staleAt INTEGER NOT NULL
    )`);
    db.prepare(`INSERT INTO cacheInterceptorV${previousSchema} (url, method, body, deleteAt, statusCode, statusMessage, headers, cacheControlDirectives, cachedAt, staleAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`${origin}//persisted`, "GET", Buffer.from("unsafe-v3"), now + 60000, 200, "OK", JSON.stringify(policy), '{"public":true,"max-age":60}', now, now + 60000);
  } finally { db.close(); }
  let store: InstanceType<typeof cacheStores.SqliteCacheStore> | undefined;
  try {
    store = new cacheStores.SqliteCacheStore({ location });
    assert.equal(await store.get(key), undefined);
    const writer = store.createWriteStream(key, {
      statusCode: 200, statusMessage: "OK", headers: policy,
      cacheControlDirectives: { public: true, "max-age": 60 },
      cachedAt: now, staleAt: now + 60000, deleteAt: now + 60000,
    });
    assert.ok(writer);
    const written = finished(writer);
    writer.end(Buffer.from("safe-v4"));
    await written;
    store.close();
    store = new cacheStores.SqliteCacheStore({ location });
    const entry = await store.get(key);
    assert.ok(entry);
    assert.deepEqual(entry.body, Buffer.from("safe-v4"));
    const inspection = new DatabaseSync(location);
    try {
      assert.ok(inspection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(`cacheInterceptorV${currentSchema}`));
    } finally { inspection.close(); }
  } finally {
    store?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

for (const mode of ["dump", "async-get"]) {
  test(`GHSA-3g9m: ${mode} replay errors stay within the request in a child process`, { timeout: 10000 }, async () => {
    const result = await promisify(execFile)(process.execPath, [
      "--unhandled-rejections=strict", "--import", "tsx",
      new URL("./undici-cache-replay.fixture.mts", import.meta.url).pathname, mode,
    ], { timeout: 5000, maxBuffer: 65536 });
    assert.equal(result.stdout.trim(), `replay-ok:${mode}`);
  });
}
