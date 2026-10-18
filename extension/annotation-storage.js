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
        if (Array.isArray(stored[key])) return stored[key].map(normalize);

        return [];
      },
      save(items) {
        return extensionStorage.set({ [key]: items });
      },
    };
  }

  var api = { createAnnotationStorage: createAnnotationStorage };
  root.PiWebAnnotatorStorage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
