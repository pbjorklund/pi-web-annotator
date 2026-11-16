type AnnotationStatus = 'pending' | 'sending' | 'sent' | 'in_progress' | 'completed';
type AnnotationRect = {x: number; y: number; w: number; h: number};
type SourceLocation = {fw: string; file?: string; line?: number; comp?: string};
type AnnotationTarget = {
  type: 'element' | 'text'; selector: string; tag: string; pageKey: string; pageUrl: string; rect: AnnotationRect;
  preview?: string; text?: string; textTruncated?: boolean; context?: string; markSelector?: string;
  elId?: string; cls?: string; attrs?: Record<string, string>; html?: string; label?: string; ord?: string;
  styles?: Record<string, string>; src?: SourceLocation | null; color?: string; bg?: string;
};
type Annotation = AnnotationTarget & {id: number; note: string; ts: number; piStatus: AnnotationStatus; piJobId?: string; piSendingAt?: number};
type PendingAnnotation = AnnotationTarget & Partial<Pick<Annotation, 'id' | 'note' | 'ts' | 'piStatus'>>;
type AnnotatorState = {
  installed: boolean; ready: boolean; items: Annotation[]; mode: boolean; targetMode: 'element' | 'text';
  show?(): void; dump?(): Annotation[]; markdown?(items?: Annotation[]): string; json?(): Annotation[];
  copy?(): void; copyJson?(): void; copyPrompt?(): void; clear?(): void; activate?(): void; destroy?(): string;
};
type ExtensionStorage = {get(key: string): Promise<Record<string, unknown>>; set(update: Record<string, unknown>): Promise<void>};
type CollectionSnapshot = {schema: 2; revision: number; nextId: number; rows: {revision: number; annotation: unknown}[]};
type CollectionOperation =
  | {kind: 'create'; annotation: Omit<Annotation, 'id'>}
  | {kind: 'update'; id: number; revision: number; annotation: Annotation}
  | {kind: 'updateMany'; updates: {id: number; revision: number; annotation: Annotation}[]}
  | {kind: 'delete'; id: number; revision: number}
  | {kind: 'clear'; revision: number};
type CollectionReply = {ok: true; collection: CollectionSnapshot; createdId?: number}
  | {ok: false; reason: 'conflict' | 'storage' | 'invalid'; error: string; collection?: CollectionSnapshot};
type StorageChanges = Record<string, {oldValue?: unknown; newValue?: unknown}>;
type StorageChangeEvent = {addListener(listener: (changes: StorageChanges, area: string) => void): void; removeListener(listener: (changes: StorageChanges, area: string) => void): void};
type AnnotationStorageOptions = {extensionStorage: ExtensionStorage; origin: string; runtime?: {sendMessage(message: unknown): Promise<unknown>}; changes?: StorageChangeEvent};
type AnnotationStorage = {key: string; load(): Promise<CollectionSnapshot>; mutate(operation: CollectionOperation): Promise<CollectionReply>; subscribe(listener: (collection: CollectionSnapshot) => void, failed: (error: Error) => void): () => void};
type AnnotationStorageApi = {createAnnotationStorage(options: AnnotationStorageOptions): AnnotationStorage};
type BrowserTab = {id?: number};
type BrowserListener<T extends unknown[]> = {addListener(listener: (...args: T) => unknown): void};
type Injection = {target: {tabId: number}; files?: string[]; args?: unknown[]; func?: (arg?: unknown) => unknown};
type DataPermission = {data_collection: string[]};
type AnnotatorBrowser = {
  storage: {local: ExtensionStorage; onChanged?: StorageChangeEvent};
  runtime: {sendMessage(message: unknown): Promise<unknown>; getURL(path: string): string; onInstalled: BrowserListener<[{reason: string}]>; onMessage: BrowserListener<[unknown, {url?: string}?]>};
  permissions: {contains(permission: DataPermission): Promise<boolean>; request(permission: DataPermission): Promise<boolean>};
  action: {onClicked: BrowserListener<[BrowserTab]>; setBadgeText(details: {tabId: number; text: string}): void; setBadgeBackgroundColor(details: {tabId: number; color: string}): void; setTitle(details: {tabId: number; title: string}): void};
  scripting: {executeScript(details: Injection): Promise<{result?: unknown}[]>};
  tabs: {create(details: {url: string}): Promise<unknown>; onUpdated: BrowserListener<[number, {status?: string}]>; onRemoved: BrowserListener<[number]>};
  commands: {onCommand: BrowserListener<[string, BrowserTab]>};
};
declare var browser: AnnotatorBrowser;
declare var PiWebAnnotatorStorage: AnnotationStorageApi;
interface Window {
  __piWebAnnotator?: AnnotatorState;
  __piWebAnnotatorStartMode?: boolean;
  ng?: {getComponent(element: Element): unknown};
}

declare var __piWebAnnotator: AnnotatorState | undefined;
