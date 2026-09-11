const test = require("node:test");
const assert = require("node:assert/strict");
const Routes = require("./route-geometry.js");

test("decodes an encoded polyline into MapLibre longitude-latitude coordinates", () => {
  assert.deepEqual(Routes.decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [
    [-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]
  ]);
});

test("uses outgoing routes and caches decoded geometry", () => {
  const origin = {id: 17, lat: 60, lon: 24};
  const destination = {id: 42, lat: 61, lon: 25};
  const cache = new Map();
  const file = {out: {"42": {p: "_p~iF~ps|U_ulLnnqC_mqNvxq`@"}}};
  const first = Routes.connectionCoordinates(origin, destination, 17, file, cache);
  assert.equal(cache.size, 1);
  assert.equal(Routes.connectionCoordinates(origin, destination, 17, file, cache), first);
  assert.deepEqual(Routes.connectionCoordinates(destination, origin, 17, file, cache), [[25, 61], [24, 60]]);
});

test("falls back for a missing or malformed route", () => {
  const origin = {id: 17, lat: 60, lon: 24};
  const destination = {id: 42, lat: 61, lon: 25};
  assert.deepEqual(Routes.connectionCoordinates(origin, destination, 17, {out: {}}, new Map()), [[24, 60], [25, 61]]);
  assert.deepEqual(Routes.connectionCoordinates(origin, destination, 17, {out: {"42": {p: "!"}}}, new Map()), [[24, 60], [25, 61]]);
});
