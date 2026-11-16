(function (root: typeof globalThis) {
  "use strict";

  var KEY_PREFIX = "pi-web-annotator:collection:v2:";
  function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
  function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
  function snapshot(value: unknown): CollectionSnapshot | undefined {
    if (!object(value) || value.schema !== 2 || !integer(value.revision) || !integer(value.nextId) || value.nextId < 1 || !Array.isArray(value.rows)) return;
    var rows: CollectionSnapshot["rows"] = [];
    for (var row of value.rows) {
      if (!object(row) || !integer(row.revision) || row.revision < 1 || row.revision > value.revision || !("annotation" in row)) return;
      rows.push({revision: row.revision, annotation: row.annotation});
    }
    return {schema: 2, revision: value.revision, nextId: value.nextId, rows: rows};
  }
  function createAnnotationStorage(options: AnnotationStorageOptions): AnnotationStorage {
    var key = KEY_PREFIX + options.origin;
    async function request(operation: CollectionOperation | {kind: "load"}): Promise<CollectionReply> {
      if (!options.runtime) throw new Error("Annotation storage messaging is unavailable. Reload the extension.");
      var value: unknown = await options.runtime.sendMessage({type: "pi-web-annotator-storage", origin: options.origin, operation: operation});
      if (!object(value)) throw new Error("Annotation storage reply is invalid. Reload saved annotations before retrying.");
      var collection = snapshot(value.collection);
      if (value.ok === true && collection) {
        const createdId = value.createdId;
        if ((createdId !== undefined && (!integer(createdId) || createdId < 1))
          || (operation.kind === "create" && (!integer(createdId) || createdId < 1 || !collection.rows.some(function (row) { return object(row.annotation) && row.annotation.id === createdId; })))) throw new Error("Invalid saved annotation ID. Reload saved annotations before retrying.");
        return {ok: true, collection: collection, ...(typeof value.createdId === "number" ? {createdId: value.createdId} : {})};
      }
      if (value.ok === false && typeof value.error === "string" && (value.reason === "conflict" || value.reason === "storage" || value.reason === "invalid")) {
        return {ok: false, reason: value.reason, error: value.error, ...(collection ? {collection: collection} : {})};
      }
      throw new Error("Annotation storage reply is invalid. Reload saved annotations before retrying.");
    }
    return {
      key: key,
      async load() {
        var reply = await request({kind: "load"});
        if (!reply.ok) throw new Error(reply.error);
        return reply.collection;
      },
      mutate: request,
      subscribe(listener, failed) {
        const changes = options.changes;
        if (!changes) throw new Error("Annotation storage synchronization is unavailable. Reload the extension.");
        var receive = function (update: StorageChanges, area: string) {
          if (area !== "local" || !(key in update)) return;
          var value = update[key].newValue;
          if (object(value) && value.migrationPending === true) return;
          var collection = snapshot(value);
          if (!collection) { failed(new Error("Saved annotation storage changed unexpectedly. Reload before editing.")); return; }
          listener(collection);
        };
        changes.addListener(receive);
        return function () { changes.removeListener(receive); };
      },
    };
  }

  var api = { createAnnotationStorage: createAnnotationStorage };
  root.PiWebAnnotatorStorage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
