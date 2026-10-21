import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Readable } from 'node:stream';
import { object } from '../pi-extension/contracts.ts';
export type RpcRecord = Record<string, unknown> & {type: string};
function isRpcRecord(value: unknown): value is RpcRecord { return object(value) && typeof value.type === 'string'; }
type Pending = {resolve(value: RpcRecord): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>};
import { StringDecoder } from 'node:string_decoder';

function attachJsonlReader(stream: Readable, onRecord: (line: string) => void) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';

  stream.on('data', (chunk: unknown) => {
    if (!Buffer.isBuffer(chunk)) throw new Error('Invalid Pi RPC bytes');
    buffer += decoder.write(chunk);
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline === -1) break;
      let line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line) onRecord(line);
    }
  });

  stream.on('end', () => {
    buffer += decoder.end();
    if (buffer.endsWith('\r')) buffer = buffer.slice(0, -1);
    if (buffer) onRecord(buffer);
  });
}

export class PiRpcClient {
  readonly process: ChildProcessWithoutNullStreams;
  requestSequence: number;
  readonly pending = new Map<string, Pending>();
  readonly listeners = new Set<(record: RpcRecord) => void>();
  stderr: string;
  constructor(process: ChildProcessWithoutNullStreams) {
    this.process = process;
    this.requestSequence = 0;
    this.stderr = '';

    attachJsonlReader(process.stdout, (line) => this.handleRecord(line));
    process.stderr.on('data', (chunk: unknown) => {
      if (!Buffer.isBuffer(chunk)) return;
      this.stderr = (this.stderr + chunk.toString()).slice(-8000);
    });
    process.once('exit', (code, signal) => {
      const error = new Error(`Pi RPC exited (${signal ?? code ?? 'unknown'})${this.stderr ? `: ${this.stderr.trim()}` : ''}`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  static start({ cwd, args, env = process.env, command = 'pi' }: {cwd: string; args: string[]; env?: NodeJS.ProcessEnv; command?: string}) {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return new PiRpcClient(child);
  }

  handleRecord(line: string) {
    let record: RpcRecord;
    try {
      const value: unknown = JSON.parse(line);
      if (!isRpcRecord(value)) return;
      record = value;
    } catch {
      return;
    }

    if (record.type === 'response' && typeof record.id === 'string' && this.pending.has(record.id)) {
      const pending = this.pending.get(record.id);
      if (!pending) return;
      this.pending.delete(record.id);
      clearTimeout(pending.timer);
      if (typeof record.success !== 'boolean') { pending.reject(new Error('Invalid Pi RPC response')); return; }
      if (record.success) pending.resolve(record);
      else pending.reject(new Error(typeof record.error === 'string' ? record.error : `Pi RPC command failed: ${String(record.command)}`));
      return;
    }

    for (const listener of this.listeners) listener(record);
  }

  onEvent(listener: (record: RpcRecord) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(command: RpcRecord, timeoutMs = 30000): Promise<RpcRecord> {
    if (!this.process.stdin.writable) return Promise.reject(new Error('Pi RPC stdin is closed'));
    const id = `demo-${++this.requestSequence}`;
    return new Promise<RpcRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi RPC command timed out: ${command.type}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  }

  waitForEvent(predicate: (record: RpcRecord) => boolean, timeoutMs = 30000): Promise<RpcRecord> {
    return new Promise<RpcRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error('Timed out waiting for Pi RPC event'));
      }, timeoutMs);
      const unsubscribe = this.onEvent((event) => {
        if (!predicate(event)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(event);
      });
    });
  }

  async close() {
    if (this.process.exitCode !== null) return;
    this.process.stdin.end();
    this.process.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolve) => this.process.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (this.process.exitCode === null) this.process.kill('SIGKILL');
  }
}
