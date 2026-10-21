import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import test from 'node:test';
import {PiRpcClient} from '../scripts/pi-rpc-client.mts';

test('RPC responses validate JSON identity and boolean success before resolving commands', async t => {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], {stdio: ['pipe', 'pipe', 'pipe']});
  const client = new PiRpcClient(child);
  t.after(() => client.close());
  const valid = client.send({type: 'get_state'}, 1000);
  assert.doesNotThrow(() => client.handleRecord('null'));
  assert.doesNotThrow(() => client.handleRecord('{"type":1}'));
  client.handleRecord('{"type":"response","id":"demo-1","success":true,"data":{"fixture":true}}');
  assert.deepEqual(await valid, {type: 'response', id: 'demo-1', success: true, data: {fixture: true}});
  const invalid = client.send({type: 'get_state'}, 1000);
  const rejected = assert.rejects(invalid, /Invalid Pi RPC response/);
  client.handleRecord('{"type":"response","id":"demo-2","success":"false"}');
  await rejected;
});
