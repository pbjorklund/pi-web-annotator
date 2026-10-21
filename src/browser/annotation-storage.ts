(function (root: typeof globalThis) {
  "use strict";

  var KEY_PREFIX = "pi-web-annotator:collection:v1:";

  function createAnnotationStorage(options: AnnotationStorageOptions): AnnotationStorage {
    var extensionStorage = options.extensionStorage;
    var key = KEY_PREFIX + options.origin;

    return {
      key: key,
      async load<T>(normalize: (value: unknown) => T) {
        var stored = await extensionStorage.get(key);
        var value: unknown = stored[key];
        if (Array.isArray(value)) { var values: unknown[] = value; return values.map(normalize); }

        return [];
      },
      save(items: unknown[]) {
        return extensionStorage.set({ [key]: items });
      },
    };
  }

  var api = { createAnnotationStorage: createAnnotationStorage };
  root.PiWebAnnotatorStorage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
