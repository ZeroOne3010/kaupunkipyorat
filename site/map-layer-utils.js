(function (root) {
  "use strict";

  function ensureSource(map, id, definition) {
    if (!map.getSource(id)) map.addSource(id, definition);
  }

  function ensureLayer(map, definition) {
    if (!map.getLayer(definition.id)) map.addLayer(definition);
  }

  function setStationHeatmapVisibility(map, coloring, stationSelected) {
    if (!map.getLayer("station-heat-busyness")) return;
    const heatmapsVisible = !stationSelected;
    map.setLayoutProperty("station-heat-busyness", "visibility", heatmapsVisible && coloring === "busyness" ? "visible" : "none");
    ["neutral", "negative-low", "positive-low", "negative", "positive", "negative-strong", "positive-strong"].forEach(category => {
      map.setLayoutProperty(`station-heat-${category}`, "visibility", heatmapsVisible && (coloring === "flow" || coloring === "weather") ? "visible" : "none");
    });
  }

  const api = {ensureSource, ensureLayer, setStationHeatmapVisibility};
  root.MapLayerUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "undefined" ? this : globalThis);
