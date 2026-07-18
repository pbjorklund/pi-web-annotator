import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

function attachJsonlReader(stream, onRecord) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';

  stream.on('data', (chunk) => {
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
  constructor(process) {
    this.process = process;
    this.requestSequence = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.stderr = '';

    attachJsonlReader(process.stdout, (line) => this.handleRecord(line));
    process.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-8000);
    });
    process.once('exit', (code, signal) => {
      const error = new Error(`Pi RPC exited (${signal ?? code ?? 'unknown'})${this.stderr ? `: ${this.stderr.trim()}` : ''}`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  static start({ cwd, args, env = process.env, command = 'pi' }) {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return new PiRpcClient(child);
  }

  handleRecord(line) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }

    if (record.type === 'response' && record.id && this.pending.has(record.id)) {
      const pending = this.pending.get(record.id);
      this.pending.delete(record.id);
      clearTimeout(pending.timer);
      if (record.success) pending.resolve(record);
      else pending.reject(new Error(record.error ?? `Pi RPC command failed: ${record.command}`));
      return;
    }

    for (const listener of this.listeners) listener(record);
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(command, timeoutMs = 30000) {
    if (!this.process.stdin.writable) return Promise.reject(new Error('Pi RPC stdin is closed'));
    const id = `demo-${++this.requestSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi RPC command timed out: ${command.type}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  }

  waitForEvent(predicate, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
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
      new Promise((resolve) => this.process.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (this.process.exitCode === null) this.process.kill('SIGKILL');
  }
}
