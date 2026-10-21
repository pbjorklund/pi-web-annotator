import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
export type Context = {
  mode?: string; hasUI?: boolean;
  ui: Pick<ExtensionContext['ui'], 'notify'> & Partial<Pick<ExtensionContext['ui'], 'setWidget'>>;
  isIdle(): boolean;
};
export type Events = {
  session_start: object; session_shutdown: object; agent_start: object; agent_settled: object;
  message_start: {message: {role: string; content?: unknown}};
  agent_end: {messages: {role: string; stopReason?: string; content?: unknown}[]};
};
export type Handlers = {[K in keyof Events]: (event: Events[K], ctx: Context) => void | Promise<void>};
export type Command = {description: string; handler(args: string, ctx: Context): Promise<void>};
export type Host = {
  on<K extends keyof Events>(name: K, handler: Handlers[K]): void;
  registerCommand(name: string, command: Command): void;
  sendUserMessage(prompt: string, options?: {deliverAs: 'followUp'}): void;
};
export type SandboxHost = {on(name: 'tool_call', handler: (event: {toolName: string; input: unknown}, ctx: {cwd: string}) => Promise<{block: boolean; reason: string} | undefined>): void};
