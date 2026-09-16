const test = require("node:test");
const assert = require("node:assert/strict");
const WeatherSensitivity = require("./weather-sensitivity");

test("parses precalculated station values into a numeric-keyed map", () => {
  const result = WeatherSensitivity.parse({v: 1, year: 2025, domain: 42, stations: {
    "1": {dryCount: 10, rainyCount: 12, value: -20, normalized: -.5},
    "2": {dryCount: 10, rainyCount: 2, value: null, normalized: null}
  }}, 2025);
  assert.equal(result.domain, 42);
  assert.deepEqual(result.stations.get(1), {dryCount: 10, rainyCount: 12, value: -20, normalized: -.5, available: true});
  assert.equal(result.stations.get(2).available, false);
});

test("rejects mismatched and malformed payloads", () => {
  assert.equal(WeatherSensitivity.parse({v: 1, year: 2024, domain: 1, stations: {}}, 2025), null);
  assert.equal(WeatherSensitivity.parse({v: 2, year: 2025, domain: 1, stations: {}}, 2025), null);
});

test("ranks available stations by the magnitude of their weather sensitivity", () => {
  const stations = new Map([
    [1, {value: -20, available: true}],
    [2, {value: 5, available: true}],
    [3, {value: 0, available: true}],
    [4, {value: null, available: false}],
    [5, {value: 20, available: true}]
  ]);

  const result = WeatherSensitivity.rankings(stations);

  assert.deepEqual(result.most.map(station => station.id), [1, 5, 2, 3]);
  assert.deepEqual(result.least.map(station => station.id), [3, 2, 1, 5]);
});
