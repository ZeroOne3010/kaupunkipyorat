(function (root) {
  "use strict";

  function ensureSource(map, id, definition) {
    if (!map.getSource(id)) map.addSource(id, definition);
  }

  function ensureLayer(map, definition) {
    if (!map.getLayer(definition.id)) map.addLayer(definition);
  }

  const api = {ensureSource, ensureLayer};
  root.MapLayerUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "undefined" ? this : globalThis);
