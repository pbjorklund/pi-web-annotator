// Generated from src/browser/background.ts; run npm run build:typescript. Do not edit.
// Web Annotator for Pi.
// The toolbar button and Alt+Shift+A toggle annotation mode for the active tab.
// While a tab is in annotation mode, the background script reinjects the overlay after
// full browser navigations. SPA navigation is handled inside the content script.
//
// Host access is used only to keep an already-enabled tab alive across navigation. Pages
// such as about:, addons.mozilla.org, PDFs, and view-source: cannot be injected, so the
// extension shows a red "!" badge instead of failing silently.
const api = globalThis.browser;
const DEFAULT_TITLE = "Toggle Web Annotator for Pi - Alt+Shift+A";
const ANNOTATION_SERVER = "http://127.0.0.1:17373";
const PI_DATA_PERMISSION = { data_collection: ["browsingActivity", "websiteContent"] };
const enabledTabs = new Set();
function backgroundObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
const collectionQueues = new Map();
const COLLECTION_CONFLICT = "This collection changed in another tab. Reload and review the current notes before trying again.";
const COLLECTION_STORAGE_ERROR = "Collection storage could not be confirmed. Your save may not have completed. Reload before trying again. Update all open annotator tabs to the latest extension version; older writers are unsupported.";
function collectionInteger(value, minimum = 0) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}
function collectionFinite(value) { return typeof value === "number" && Number.isFinite(value); }
function collectionStrings(value) {
    return backgroundObject(value) && Object.values(value).every(item => typeof item === "string");
}
function collectionAnnotation(value) {
    if (!backgroundObject(value) || !collectionInteger(value.id, 1) || typeof value.note !== "string" || !collectionFinite(value.ts))
        return false;
    if (value.type !== "element" && value.type !== "text")
        return false;
    if (value.piStatus !== "pending" && value.piStatus !== "sending" && value.piStatus !== "sent" && value.piStatus !== "in_progress" && value.piStatus !== "completed")
        return false;
    for (const key of ["selector", "tag", "pageKey", "pageUrl"])
        if (typeof value[key] !== "string")
            return false;
    if (!backgroundObject(value.rect) || ![value.rect.x, value.rect.y, value.rect.w, value.rect.h].every(collectionFinite))
        return false;
    if (Object.keys(value.rect).some(key => !["x", "y", "w", "h"].includes(key)))
        return false;
    for (const key of ["preview", "text", "context", "markSelector", "elId", "cls", "html", "label", "ord", "color", "bg", "piJobId"]) {
        if (value[key] !== undefined && typeof value[key] !== "string")
            return false;
    }
    if (value.textTruncated !== undefined && typeof value.textTruncated !== "boolean")
        return false;
    if (value.piSendingAt !== undefined && !collectionFinite(value.piSendingAt))
        return false;
    if (value.attrs !== undefined && !collectionStrings(value.attrs))
        return false;
    if (value.styles !== undefined && !collectionStrings(value.styles))
        return false;
    if (value.src !== undefined && value.src !== null) {
        if (!backgroundObject(value.src) || typeof value.src.fw !== "string")
            return false;
        if (value.src.file !== undefined && typeof value.src.file !== "string")
            return false;
        if (value.src.comp !== undefined && typeof value.src.comp !== "string")
            return false;
        if (value.src.line !== undefined && !collectionFinite(value.src.line))
            return false;
        if (Object.keys(value.src).some(key => !["fw", "file", "line", "comp"].includes(key)))
            return false;
    }
    const allowed = new Set(["id", "note", "ts", "piStatus", "type", "selector", "tag", "pageKey", "pageUrl", "rect", "preview", "text", "context", "markSelector", "elId", "cls", "html", "label", "ord", "color", "bg", "piJobId", "textTruncated", "piSendingAt", "attrs", "styles", "src"]);
    return Object.keys(value).every(key => allowed.has(key));
}
function collectionOperation(value) {
    if (!backgroundObject(value))
        return undefined;
    if (value.kind === "load")
        return { kind: "load" };
    if (value.kind === "create" && backgroundObject(value.annotation)) {
        const annotation = { ...value.annotation, id: 1 };
        if (collectionAnnotation(annotation))
            return { kind: "create", annotation };
    }
    if (value.kind === "updateMany" && Array.isArray(value.updates) && value.updates.length > 0) {
        const updates = [], ids = new Set();
        const rawUpdates = value.updates;
        for (const update of rawUpdates) {
            if (!backgroundObject(update) || !collectionInteger(update.id, 1) || !collectionInteger(update.revision, 1) || !collectionAnnotation(update.annotation) || update.annotation.id !== update.id || ids.has(update.id))
                return undefined;
            ids.add(update.id);
            updates.push({ id: update.id, revision: update.revision, annotation: update.annotation });
        }
        return { kind: "updateMany", updates };
    }
    if (value.kind === "clear" && collectionInteger(value.revision))
        return { kind: "clear", revision: value.revision };
    if ((value.kind === "update" || value.kind === "delete") && collectionInteger(value.id, 1) && collectionInteger(value.revision, 1)) {
        if (value.kind === "delete")
            return { kind: "delete", id: value.id, revision: value.revision };
        if (collectionAnnotation(value.annotation) && value.annotation.id === value.id)
            return { kind: "updateMany", updates: [{ id: value.id, revision: value.revision, annotation: value.annotation }] };
    }
    return undefined;
}
function collectionEnvelope(value) {
    if (!backgroundObject(value) || value.schema !== 2 || !collectionInteger(value.revision) || !collectionInteger(value.nextId, 1) || !Array.isArray(value.rows))
        return undefined;
    if (value.migrationPending !== undefined && value.migrationPending !== true)
        return undefined;
    if (!Object.keys(value).every(key => ["schema", "revision", "nextId", "rows", "migrationPending"].includes(key)))
        return undefined;
    const rows = [], ids = new Set();
    const rawRows = value.rows;
    for (const row of rawRows) {
        if (!backgroundObject(row) || !collectionInteger(row.revision, 1) || row.revision > value.revision || !collectionAnnotation(row.annotation))
            return undefined;
        if (Object.keys(row).some(key => key !== "revision" && key !== "annotation"))
            return undefined;
        if (ids.has(row.annotation.id) || row.annotation.id >= value.nextId)
            return undefined;
        ids.add(row.annotation.id);
        rows.push({ revision: row.revision, annotation: row.annotation });
    }
    return { schema: 2, revision: value.revision, nextId: value.nextId, rows, ...(value.migrationPending ? { migrationPending: true } : {}) };
}
function collectionPublic(collection) {
    return { schema: 2, revision: collection.revision, nextId: collection.nextId, rows: collection.rows };
}
// Only v1 migration uses the former UI defaults; current writes and v2 remain strict.
function collectionLegacyAnnotation(value, page) {
    if (!backgroundObject(value) || !collectionFinite(value.id) || typeof value.note !== "string" || typeof value.selector !== "string")
        return undefined;
    const rect = value.rect;
    const piStatus = value.piStatus;
    const annotation = {
        id: value.id, note: value.note, selector: value.selector,
        tag: typeof value.tag === "string" ? value.tag : "", type: value.type === "text" ? "text" : "element",
        pageKey: typeof value.pageKey === "string" && value.pageKey ? value.pageKey : page.origin + page.pathname + page.search + page.hash,
        pageUrl: typeof value.pageUrl === "string" && value.pageUrl ? value.pageUrl : page.href,
        rect: backgroundObject(rect) && collectionFinite(rect.x) && collectionFinite(rect.y) && collectionFinite(rect.w) && collectionFinite(rect.h)
            ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : { x: 0, y: 0, w: 0, h: 0 },
        ts: collectionFinite(value.ts) ? value.ts : 0,
        piStatus: piStatus === "pending" || piStatus === "sending" || piStatus === "sent" || piStatus === "in_progress" || piStatus === "completed" ? piStatus : "pending",
    };
    const strings = ["preview", "text", "context", "markSelector", "elId", "cls", "html", "label", "ord", "color", "bg", "piJobId"];
    for (const key of strings) {
        const field = value[key];
        if (typeof field === "string")
            annotation[key] = field;
    }
    if (typeof value.textTruncated === "boolean")
        annotation.textTruncated = value.textTruncated;
    if (collectionFinite(value.piSendingAt))
        annotation.piSendingAt = value.piSendingAt;
    if (backgroundObject(value.src) && typeof value.src.fw === "string") {
        annotation.src = { fw: value.src.fw };
        if (typeof value.src.file === "string")
            annotation.src.file = value.src.file;
        if (collectionFinite(value.src.line))
            annotation.src.line = value.src.line;
        if (typeof value.src.comp === "string")
            annotation.src.comp = value.src.comp;
    }
    const maps = ["attrs", "styles"];
    for (const key of maps) {
        const fields = value[key];
        if (backgroundObject(fields)) {
            const strings = {};
            for (const name in fields) {
                const field = fields[name];
                if (typeof field === "string")
                    strings[name] = field;
            }
            annotation[key] = strings;
        }
    }
    return annotation;
}
async function collectionRead(origin, page) {
    const key = "pi-web-annotator:collection:v2:" + origin, legacyKey = "pi-web-annotator:collection:v1:" + origin;
    const stored = await api.storage.local.get(key);
    let collection;
    if (stored[key] !== undefined) {
        const parsed = collectionEnvelope(stored[key]);
        if (!parsed)
            throw new Error("Invalid saved collection");
        collection = parsed;
    }
    else {
        const legacy = (await api.storage.local.get(legacyKey))[legacyKey];
        collection = { schema: 2, revision: 0, nextId: 1, rows: [] };
        if (legacy !== undefined) {
            if (!Array.isArray(legacy))
                throw new Error("Invalid legacy collection");
            const records = legacy, used = new Set(), reserved = new Set();
            for (const record of records)
                if (backgroundObject(record) && collectionInteger(record.id, 1))
                    reserved.add(record.id);
            for (const record of records) {
                const annotation = collectionLegacyAnnotation(record, page);
                if (!annotation)
                    throw new Error("Invalid legacy annotation");
                const previousId = annotation.id;
                let id = collectionInteger(previousId, 1) && !used.has(previousId) ? previousId : 1;
                if (!collectionInteger(previousId, 1) || used.has(previousId)) {
                    while (used.has(id) || reserved.has(id))
                        id++;
                }
                annotation.id = id;
                if (!collectionAnnotation(annotation) || id >= Number.MAX_SAFE_INTEGER)
                    throw new Error("Invalid legacy annotation");
                if (annotation.type === "text" && id !== previousId)
                    annotation.markSelector = "mark[data-bh-anno-id='" + id + "']";
                used.add(id);
                collection.rows.push({ revision: 1, annotation });
                collection.nextId = Math.max(collection.nextId, id + 1);
            }
            if (collection.rows.length) {
                collection.revision = 1;
                collection.migrationPending = true;
                await api.storage.local.set({ [key]: collection });
            }
        }
    }
    if (collection.migrationPending) {
        await api.storage.local.set({ [legacyKey]: [] });
        collection = { ...collectionPublic(collection), rows: collection.rows };
        await api.storage.local.set({ [key]: collection });
    }
    return collection;
}
async function collectionApply(origin, operation, page) {
    try {
        const collection = await collectionRead(origin, page);
        if (operation.kind === "load")
            return { ok: true, collection: collectionPublic(collection) };
        const updates = operation.kind === "updateMany" ? operation.updates : operation.kind === "update" ? [operation] : [];
        const row = operation.kind === "delete" ? collection.rows.find(row => row.annotation.id === operation.id) : undefined;
        const staleUpdate = updates.some(update => !collection.rows.some(row => row.annotation.id === update.id && row.revision === update.revision));
        if (staleUpdate || (operation.kind === "clear" && operation.revision !== collection.revision) || (operation.kind === "delete" && (!row || row.revision !== operation.revision))) {
            return { ok: false, reason: "conflict", error: COLLECTION_CONFLICT, collection: collectionPublic(collection) };
        }
        if (collection.revision >= Number.MAX_SAFE_INTEGER || (operation.kind === "create" && collection.nextId >= Number.MAX_SAFE_INTEGER))
            throw new Error("Collection counter exhausted");
        const revision = collection.revision + 1;
        let createdId;
        if (operation.kind === "create") {
            createdId = collection.nextId++;
            const annotation = { ...operation.annotation, id: createdId };
            if (annotation.type === "text")
                annotation.markSelector = "mark[data-bh-anno-id='" + createdId + "']";
            collection.rows.push({ revision, annotation });
        }
        else if (operation.kind === "update" || operation.kind === "updateMany") {
            const replacements = new Map(updates.map(update => [update.id, update.annotation]));
            collection.rows = collection.rows.map(row => {
                const annotation = replacements.get(row.annotation.id);
                return annotation ? { revision, annotation } : row;
            });
        }
        else if (operation.kind === "delete")
            collection.rows = collection.rows.filter(row => row.annotation.id !== operation.id);
        else if (operation.kind === "clear")
            collection.rows = [];
        collection.revision = revision;
        await api.storage.local.set({ ["pi-web-annotator:collection:v2:" + origin]: collection });
        return { ok: true, collection: collectionPublic(collection), ...(createdId === undefined ? {} : { createdId }) };
    }
    catch {
        return { ok: false, reason: "storage", error: COLLECTION_STORAGE_ERROR };
    }
}
function collectionMessage(message, sender) {
    const invalid = { ok: false, reason: "invalid", error: "Invalid collection request or page origin. Reload this page with the latest extension." };
    if (typeof message.origin !== "string" || typeof sender?.url !== "string")
        return Promise.resolve(invalid);
    let page;
    try {
        page = new URL(sender.url);
        if (page.origin !== message.origin)
            return Promise.resolve(invalid);
    }
    catch {
        return Promise.resolve(invalid);
    }
    const operation = collectionOperation(message.operation);
    if (!operation)
        return Promise.resolve(invalid);
    const origin = message.origin;
    const result = (collectionQueues.get(origin) ?? Promise.resolve()).then(() => collectionApply(origin, operation, page));
    const tail = result.then(() => { }, () => { });
    collectionQueues.set(origin, tail);
    void tail.then(() => { if (collectionQueues.get(origin) === tail)
        collectionQueues.delete(origin); });
    return result;
}
async function annotationServerRequest(path, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    try {
        const response = await fetch(ANNOTATION_SERVER + path, {
            ...options,
            cache: "no-store",
            signal: controller.signal,
            headers: {
                "X-Pi-Web-Annotator": "1",
                ...(options && options.body ? { "Content-Type": "application/json" } : {}),
            },
        });
        const value = await response.json();
        if (!backgroundObject(value))
            throw new Error("Invalid annotation server response");
        const body = value;
        if (!response.ok)
            throw new Error(typeof body.error === "string" ? body.error : "Annotation server request failed");
        return { ok: true, ...body };
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Annotation server unavailable" };
    }
    finally {
        clearTimeout(timeout);
    }
}
async function annotationDataMessage(message) {
    let granted = false;
    try {
        granted = await api.permissions.contains(PI_DATA_PERMISSION);
    }
    catch { /* Missing or failing permission APIs cannot authorize a relay. */ }
    if (granted !== true)
        return { ok: false, error: "Firefox data permission is required. Review consent with Send to Pi." };
    if (message.type === "pi-web-annotator-send") {
        return annotationServerRequest("/jobs", { method: "POST", body: JSON.stringify(message.job) });
    }
    return annotationServerRequest("/jobs/status", { method: "POST", body: JSON.stringify({ ids: message.jobIds }) });
}
function annotationServerMessage(message, sender) {
    if (!backgroundObject(message) || typeof message.type !== "string")
        return undefined;
    if (message.type === "pi-web-annotator-storage")
        return collectionMessage(message, sender);
    if (message.type === "pi-web-annotator-health") {
        return annotationServerRequest("/health");
    }
    if (message.type === "pi-web-annotator-consent") {
        return api.permissions.contains(PI_DATA_PERMISSION).then(async (granted) => {
            if (granted)
                return { granted: true };
            await api.tabs.create({ url: api.runtime.getURL("consent.html") });
            return { granted: false };
        });
    }
    if (message.type === "pi-web-annotator-send" || message.type === "pi-web-annotator-status") {
        return annotationDataMessage(message);
    }
    return undefined;
}
function badge(tabId, text, color) {
    api.action.setBadgeText({ tabId, text: text || "" });
    if (text)
        api.action.setBadgeBackgroundColor({ tabId, color: color || "#10A37F" });
}
function setTitle(tabId, title) {
    api.action.setTitle({ tabId, title: title || DEFAULT_TITLE });
}
async function execute(tabId, details) {
    const [result] = await api.scripting.executeScript({
        target: { tabId },
        ...details,
    });
    return result ? result.result : undefined;
}
async function injectOverlay(tabId) {
    await execute(tabId, { files: ["annotation-storage.js", "web-annotator.js"] });
    badge(tabId, "●", "#10A37F");
    setTitle(tabId);
}
async function enable(tabId) {
    await injectOverlay(tabId);
    enabledTabs.add(tabId);
}
async function disable(tabId) {
    try {
        await execute(tabId, {
            func: () => {
                try {
                    if (window.__piWebAnnotator && window.__piWebAnnotator.destroy)
                        window.__piWebAnnotator.destroy();
                }
                catch (e) { }
            },
        });
    }
    catch (e) { }
    enabledTabs.delete(tabId);
    badge(tabId, "");
    setTitle(tabId);
}
async function toggle(tabId) {
    if (enabledTabs.has(tabId))
        await disable(tabId);
    else
        await enable(tabId);
}
async function callOverlay(tabId, method) {
    await execute(tabId, {
        args: [method],
        func: (methodName) => {
            try {
                const annotations = window.__piWebAnnotator;
                if (annotations && (methodName === "copy" || methodName === "copyJson"))
                    annotations[methodName]?.();
            }
            catch (e) { }
        },
    });
}
function showUnsupportedPage(tabId) {
    badge(tabId, "!", "#B00020");
    setTitle(tabId, "Can't annotate this page (about: / addons.mozilla.org / PDF / view-source)");
}
api.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason !== "install")
        return;
    await api.tabs.create({ url: api.runtime.getURL("welcome.html") });
});
api.runtime.onMessage.addListener(annotationServerMessage);
api.action.onClicked.addListener(async (tab) => {
    if (!tab || tab.id == null)
        return;
    try {
        await toggle(tab.id);
    }
    catch (e) {
        showUnsupportedPage(tab.id);
    }
});
api.commands.onCommand.addListener(async (command, tab) => {
    if (!tab || tab.id == null)
        return;
    try {
        if (command === "copy-annotations")
            await callOverlay(tab.id, "copy");
        if (command === "copy-annotations-json")
            await callOverlay(tab.id, "copyJson");
    }
    catch (e) {
        showUnsupportedPage(tab.id);
    }
});
api.tabs.onUpdated.addListener(async (tabId, info) => {
    if (!enabledTabs.has(tabId))
        return;
    if (info.status === "loading") {
        badge(tabId, "...", "#10A37F");
        setTitle(tabId, "Annotations will resume after navigation finishes");
        return;
    }
    if (info.status !== "complete")
        return;
    try {
        await injectOverlay(tabId);
    }
    catch (e) {
        showUnsupportedPage(tabId);
    }
});
api.tabs.onRemoved.addListener((tabId) => {
    enabledTabs.delete(tabId);
});
