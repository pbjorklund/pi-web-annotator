// Generated from src/browser/annotation-storage.ts; run npm run build:typescript. Do not edit.
(function (root) {
    "use strict";
    var KEY_PREFIX = "pi-web-annotator:collection:v1:";
    function createAnnotationStorage(options) {
        var extensionStorage = options.extensionStorage;
        var key = KEY_PREFIX + options.origin;
        return {
            key: key,
            async load(normalize) {
                var stored = await extensionStorage.get(key);
                var value = stored[key];
                if (Array.isArray(value)) {
                    var values = value;
                    return values.map(normalize);
                }
                return [];
            },
            save(items) {
                return extensionStorage.set({ [key]: items });
            },
        };
    }
    var api = { createAnnotationStorage: createAnnotationStorage };
    root.PiWebAnnotatorStorage = api;
    if (typeof module !== "undefined" && module.exports)
        module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
