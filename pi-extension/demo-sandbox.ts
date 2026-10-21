import { resolve, sep } from 'node:path';
import type { SandboxHost } from './host.ts';
import { object } from './contracts.ts';

const FILE_TOOLS = new Set(['read', 'edit', 'write']);
const BLOCK_REASON = 'Demo file tools are limited to the temporary demo workspace';

export default function demoSandboxExtension(pi: SandboxHost) {
  pi.on('tool_call', async (event, ctx) => {
    if (!FILE_TOOLS.has(event.toolName)) return;
    const input: unknown = event.input;
    if (!object(input) || typeof input.path !== 'string') return { block: true, reason: BLOCK_REASON };

    const root = resolve(ctx.cwd);
    const requestedPath = input.path.startsWith('@') ? input.path.slice(1) : input.path;
    const target = resolve(root, requestedPath);
    if (target !== root && !target.startsWith(root + sep)) {
      return { block: true, reason: BLOCK_REASON };
    }
  });
}
