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
  assert.equal(Routes.connectionCoordinates(destination, origin, 17, file, cache), null);
  assert.equal(cache.size, 1);
});

test("omits incoming connections when only the selected station's outgoing routes are loaded", () => {
  const selected = {id: 1, lat: 60, lon: 24};
  const other = {id: 99, lat: 61, lon: 25};
  const selectedRoutes = {out: {"99": {p: "_p~iF~ps|U_ulLnnqC_mqNvxq`@"}}};
  assert.equal(Routes.connectionCoordinates(other, selected, 1, selectedRoutes, new Map()), null);
});

test("keeps unrelated connections straight when a station route file is loaded", () => {
  const origin = {id: 17, lat: 60, lon: 24};
  const destination = {id: 42, lat: 61, lon: 25};
  const file = {out: {"42": {p: "_p~iF~ps|U_ulLnnqC_mqNvxq`@"}}};
  assert.deepEqual(Routes.connectionCoordinates(origin, destination, 99, file, new Map()), [[24, 60], [25, 61]]);
});

test("falls back for a missing or malformed route", () => {
  const origin = {id: 17, lat: 60, lon: 24};
  const destination = {id: 42, lat: 61, lon: 25};
  assert.deepEqual(Routes.connectionCoordinates(origin, destination, 17, {out: {}}, new Map()), [[24, 60], [25, 61]]);
  assert.deepEqual(Routes.connectionCoordinates(origin, destination, 17, {out: {"42": {p: "!"}}}, new Map()), [[24, 60], [25, 61]]);
});
