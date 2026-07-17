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
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Annotation server request failed");
    return { ok: true, ...body };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Annotation server unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

function annotationServerMessage(message) {
  if (!message || typeof message.type !== "string") return undefined;
  if (message.type === "pi-web-annotator-health") {
    return annotationServerRequest("/health");
  }
  if (message.type === "pi-web-annotator-consent") {
    return api.permissions.contains(PI_DATA_PERMISSION).then(async (granted) => {
      if (granted) return { granted: true };
      await api.tabs.create({ url: api.runtime.getURL("consent.html") });
      return { granted: false };
    });
  }
  if (message.type === "pi-web-annotator-send") {
    return annotationServerRequest("/jobs", {
      method: "POST",
      body: JSON.stringify(message.job),
    });
  }
  if (message.type === "pi-web-annotator-status") {
    return annotationServerRequest("/jobs/status", {
      method: "POST",
      body: JSON.stringify({ ids: message.jobIds }),
    });
  }
  return undefined;
}

function badge(tabId, text, color) {
  api.action.setBadgeText({ tabId, text: text || "" });
  if (text) api.action.setBadgeBackgroundColor({ tabId, color: color || "#10A37F" });
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
          if (window.__piWebAnnotator && window.__piWebAnnotator.destroy) window.__piWebAnnotator.destroy();
        } catch (e) {}
      },
    });
  } catch (e) {}
  enabledTabs.delete(tabId);
  badge(tabId, "");
  setTitle(tabId);
}

async function toggle(tabId) {
  if (enabledTabs.has(tabId)) await disable(tabId);
  else await enable(tabId);
}

async function callOverlay(tabId, method) {
  await execute(tabId, {
    args: [method],
    func: (methodName) => {
      try {
        const annotations = window.__piWebAnnotator;
        if (annotations && annotations[methodName]) annotations[methodName]();
      } catch (e) {}
    },
  });
}

function showUnsupportedPage(tabId) {
  badge(tabId, "!", "#B00020");
  setTitle(tabId, "Can't annotate this page (about: / addons.mozilla.org / PDF / view-source)");
}

api.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;
  await api.tabs.create({ url: api.runtime.getURL("welcome.html") });
});

api.runtime.onMessage.addListener(annotationServerMessage);

api.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id == null) return;
  try {
    await toggle(tab.id);
  } catch (e) {
    showUnsupportedPage(tab.id);
  }
});

api.commands.onCommand.addListener(async (command, tab) => {
  if (!tab || tab.id == null) return;
  try {
    if (command === "copy-annotations") await callOverlay(tab.id, "copy");
    if (command === "copy-annotations-json") await callOverlay(tab.id, "copyJson");
  } catch (e) {
    showUnsupportedPage(tab.id);
  }
});

api.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!enabledTabs.has(tabId)) return;
  if (info.status === "loading") {
    badge(tabId, "...", "#10A37F");
    setTitle(tabId, "Annotations will resume after navigation finishes");
    return;
  }
  if (info.status !== "complete") return;
  try {
    await injectOverlay(tabId);
  } catch (e) {
    showUnsupportedPage(tabId);
  }
});

api.tabs.onRemoved.addListener((tabId) => {
  enabledTabs.delete(tabId);
});
