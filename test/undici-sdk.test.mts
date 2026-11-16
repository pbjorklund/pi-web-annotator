import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const rootRequire = createRequire(import.meta.url);
const sdkRequire = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
const aiRequire = createRequire(import.meta.resolve("@earendil-works/pi-ai"));
const openaiRequire = createRequire(aiRequire.resolve("openai"));
const webextRequire = createRequire(rootRequire.resolve("web-ext"));
const linterRequire = createRequire(webextRequire.resolve("addons-linter"));
const cheerioRequire = createRequire(linterRequire.resolve("cheerio"));

for (const [name, consumer, version] of [
  ["coding SDK", sdkRequire, "8.12.4"],
  ["OpenAI SDK", openaiRequire, "7.30.2"],
  ["Firefox linter", cheerioRequire, "7.30.2"],
] as const) {
  test(`${name} resolved Undici rejects whitespace-prefixed wrong integrity`, { timeout: 10_000 }, async () => {
    const metadata: unknown = consumer("undici/package.json");
    assert.ok(metadata && typeof metadata === "object" && "version" in metadata);
    assert.equal(metadata.version, version);
    const script = `
      const assert = require('node:assert/strict');
      const {createHash} = require('node:crypto');
      const {fetch,MockAgent} = require(process.argv[1]);
      const body='synthetic consumer integrity fixture';
      const digest=value=>createHash('sha256').update(value).digest('base64');
      (async()=>{const agent=new MockAgent();agent.disableNetConnect();
        try{const pool=agent.get('https://integrity-fixture.invalid');
          for(const whitespace of [' ','\\t','\\n','\\r','\\f',' ']){
            pool.intercept({path:'/fixture',method:'GET'}).reply(200,body).times(2);
            await assert.rejects(fetch('https://integrity-fixture.invalid/fixture',
              {dispatcher:agent,integrity:whitespace+'sha256-'+digest('wrong')}),
              error=>error instanceof TypeError && /integrity mismatch/i.test(error.cause?.message));
            const response=await fetch('https://integrity-fixture.invalid/fixture',
              {dispatcher:agent,integrity:whitespace+'sha256-'+digest(body)});
            assert.equal(await response.text(),body);
          }
          agent.assertNoPendingInterceptors();
        }finally{await agent.close();}
      })().catch(error=>{console.error(error);process.exitCode=1});
    `;
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [
      "--unhandled-rejections=strict", "-e", script, consumer.resolve("undici"),
    ], { env: { PATH: process.env.PATH ?? "", NODE_OPTIONS: process.env.NODE_OPTIONS ?? "" }, timeout: 8000, maxBuffer: 64 * 1024 });
    assert.equal(stdout, "");
    assert.equal(stderr, "");
  });
}

test("modular SDK installs integrity-checking fetch with development Undici", { timeout: 20_000 }, async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [
    "--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("./undici-sdk.fixture.mts", import.meta.url)),
  ], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { PATH: process.env.PATH ?? "", NODE_OPTIONS: process.env.NODE_OPTIONS ?? "" },
    timeout: 15_000,
    maxBuffer: 64 * 1024,
  });
  assert.equal(stdout.trim(), "SDK dispatcher integrity fixture passed");
  assert.equal(stderr, "");
});
