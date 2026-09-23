const assert = require("node:assert/strict");
const test = require("node:test");
const CorridorGeometry = require("./corridor-geometry.js");
const RouteGeometry = require("./route-geometry.js");

test("parses compact corridors without a geometric tolerance", () => {
  const result = CorridorGeometry.parse({v: 1, year: 2025, from: "2025-04", to: "2025-10",
    corridors: [["??_ibE?", 18420]]}, 2025, RouteGeometry.decodePolyline);
  assert.equal(result.geojson.features[0].properties.trips, 18420);
  assert.deepEqual(result.geojson.features[0].geometry.coordinates, [[0, 0], [0, 1]]);
  assert.equal(CorridorGeometry.periodLabel(2025), "Apr–Oct 2025");
});

test("rejects the wrong season and skips malformed rows", () => {
  assert.equal(CorridorGeometry.parse({v: 1, year: 2024, corridors: []}, 2025, () => []), null);
  assert.equal(CorridorGeometry.parse({v: 1, year: 2025, corridors: [[null, 1], ["bad", -2]]}, 2025, () => []).geojson.features.length, 0);
});
