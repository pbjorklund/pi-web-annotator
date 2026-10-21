import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import type {Events, Handlers} from '../pi-extension/host.ts';
type Compatible<T extends (pi: ExtensionAPI) => void> = T;
export type NativeCompatibility = Compatible<typeof import('../pi-extension/index.ts').default>;
export type SandboxCompatibility = Compatible<typeof import('../pi-extension/demo-sandbox.ts').default>;
const missing = (): never => {throw new Error('Missing event registration');};
export class HandlerStore {
  readonly entries: Handlers = {session_start: missing, session_shutdown: missing, agent_start: missing, agent_end: missing, agent_settled: missing, message_start: missing};
  set<K extends keyof Events>(name: K, handler: Handlers[K]) {
    this.entries[name] = handler;
  }
}
