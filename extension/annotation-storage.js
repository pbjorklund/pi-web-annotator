(function (root) {
  "use strict";

  var KEY_PREFIX = "pi-web-annotator:collection:v1:";
  var LEGACY_COLLECTION_KEYS = [
    "browser-annotations:collection:v1",
    "bh-anno:collection:v1",
  ];

  function createAnnotationStorage(options) {
    var extensionStorage = options.extensionStorage;
    var pageStorage = options.pageStorage;
    var key = KEY_PREFIX + options.origin;
    var legacyKeys = LEGACY_COLLECTION_KEYS.concat([
      "bh-anno:" + options.pathname + options.hash,
    ]);

    return {
      key: key,
      async load(normalize) {
        var stored = await extensionStorage.get(key);
        if (Array.isArray(stored[key])) return stored[key].map(normalize);

        for (var index = 0; index < legacyKeys.length; index++) {
          var legacyKey = legacyKeys[index];
          var raw = pageStorage.getItem(legacyKey);
          if (!raw) continue;
          var items = JSON.parse(raw);
          if (!Array.isArray(items)) continue;
          items = items.map(normalize);
          await extensionStorage.set({ [key]: items });
          pageStorage.removeItem(legacyKey);
          return items;
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
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
