import { resolve, sep } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const FILE_TOOLS = new Set(['read', 'edit', 'write']);
const BLOCK_REASON = 'Demo file tools are limited to the temporary demo workspace';

export default function demoSandboxExtension(pi: ExtensionAPI) {
  pi.on('tool_call', async (event, ctx) => {
    if (!FILE_TOOLS.has(event.toolName)) return;
    const input = event.input as { path?: unknown };
    if (typeof input.path !== 'string') return { block: true, reason: BLOCK_REASON };

    const root = resolve(ctx.cwd);
    const requestedPath = input.path.startsWith('@') ? input.path.slice(1) : input.path;
    const target = resolve(root, requestedPath);
    if (target !== root && !target.startsWith(root + sep)) {
      return { block: true, reason: BLOCK_REASON };
    }
  });
}
