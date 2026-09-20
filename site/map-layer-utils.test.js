const assert = require("node:assert/strict");
const {ensureSource, ensureLayer, setStationHeatmapVisibility} = require("./map-layer-utils.js");

const sources = new Map([["existing", {preserved: true}]]);
const layers = new Map([["existing", {id: "existing", preserved: true}]]);
const map = {
  getSource: id => sources.get(id),
  addSource: (id, source) => sources.set(id, source),
  getLayer: id => layers.get(id),
  addLayer: layer => layers.set(layer.id, layer)
};

ensureSource(map, "existing", {preserved: false});
ensureSource(map, "restored", {type: "geojson"});
ensureLayer(map, {id: "existing", preserved: false});
ensureLayer(map, {id: "restored", type: "circle"});

assert.deepEqual(sources.get("existing"), {preserved: true});
assert.deepEqual(sources.get("restored"), {type: "geojson"});
assert.deepEqual(layers.get("existing"), {id: "existing", preserved: true});
assert.deepEqual(layers.get("restored"), {id: "restored", type: "circle"});

const heatmapLayers = new Map([
  ["station-heat-busyness", {}],
  ...["neutral", "negative-low", "positive-low", "negative", "positive", "negative-strong", "positive-strong"]
    .map(category => [`station-heat-${category}`, {}])
]);
const heatmapVisibility = new Map();
const heatmapMap = {
  getLayer: id => heatmapLayers.get(id),
  setLayoutProperty: (id, property, value) => heatmapVisibility.set(`${id}:${property}`, value)
};

setStationHeatmapVisibility(heatmapMap, "flow", true);
assert.equal(heatmapVisibility.get("station-heat-busyness:visibility"), "none");
assert.equal(heatmapVisibility.get("station-heat-positive:visibility"), "none");

setStationHeatmapVisibility(heatmapMap, "flow", false);
assert.equal(heatmapVisibility.get("station-heat-busyness:visibility"), "none");
assert.equal(heatmapVisibility.get("station-heat-positive:visibility"), "visible");

setStationHeatmapVisibility(heatmapMap, "busyness", false);
assert.equal(heatmapVisibility.get("station-heat-busyness:visibility"), "visible");
assert.equal(heatmapVisibility.get("station-heat-positive:visibility"), "none");

console.log("map layer utility tests passed");
