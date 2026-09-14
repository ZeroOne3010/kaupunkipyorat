const assert = require("node:assert/strict");
const {ensureSource, ensureLayer} = require("./map-layer-utils.js");

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

console.log("map layer utility tests passed");
