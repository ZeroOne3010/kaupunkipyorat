(function (root) {
  "use strict";

  function ensureSource(map, id, definition) {
    if (!map.getSource(id)) map.addSource(id, definition);
  }

  function ensureLayer(map, definition) {
    if (!map.getLayer(definition.id)) map.addLayer(definition);
  }

  const stationCircleOpacity = ["interpolate", ["linear"], ["zoom"], 11.5, 0, 12, 1];

  function setStationHeatmapVisibility(map, coloring, stationSelected, heatmapEnabled = true) {
    if (!map.getLayer("station-heat-busyness")) return;
    const heatmapsVisible = heatmapEnabled && !stationSelected;
    map.setLayoutProperty("station-heat-busyness", "visibility", heatmapsVisible && coloring === "busyness" ? "visible" : "none");
    ["neutral", "negative-low", "positive-low", "negative", "positive", "negative-strong", "positive-strong"].forEach(category => {
      map.setLayoutProperty(`station-heat-${category}`, "visibility", heatmapsVisible && (coloring === "flow" || coloring === "weather") ? "visible" : "none");
    });
    if (!map.getLayer("stations")) return;
    map.setLayerZoomRange("stations", heatmapEnabled ? 11.5 : 0, 24);
    map.setPaintProperty("stations", "circle-opacity", heatmapEnabled ? stationCircleOpacity : 1);
    map.setPaintProperty("stations", "circle-stroke-opacity", heatmapEnabled ? stationCircleOpacity : 1);
  }

  const api = {ensureSource, ensureLayer, setStationHeatmapVisibility};
  root.MapLayerUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "undefined" ? this : globalThis);
