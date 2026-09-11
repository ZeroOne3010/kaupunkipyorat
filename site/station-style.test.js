const test = require("node:test");
const assert = require("node:assert/strict");
const {divergingCategory, flowBalanceMetric, busynessMetric, stationProperties, heatmapColor} = require("./station-style.js");

test("divergingCategory supports configurable, symmetric bands", () => {
  assert.equal(divergingCategory(0.1, [0.1, 0.2, 0.4]), "neutral");
  assert.equal(divergingCategory(-0.11, [0.1, 0.2, 0.4]), "negative-low");
  assert.equal(divergingCategory(0.3, [0.1, 0.2, 0.4]), "positive");
  assert.equal(divergingCategory(-0.5, [0.1, 0.2, 0.4]), "negative-strong");
});

test("busyness uses a square-root scale and maps the busiest station to one", () => {
  assert.deepEqual(stationProperties(busynessMetric(100), {arrivals: 50, departures: 50, roundTrips: 0}), {
    colorCategory: "busyness", colorWeight: 1, normalizedBusyness: 1, busyness: 100
  });
  assert.deepEqual(stationProperties(busynessMetric(100), {arrivals: 13, departures: 16, roundTrips: 4}), {
    colorCategory: "busyness", colorWeight: 0.5, normalizedBusyness: 0.5, busyness: 25
  });
});

test("stationProperties delegates styling to the selected metric", () => {
  assert.deepEqual(stationProperties(flowBalanceMetric, {arrivals: 60, departures: 40}), {
    colorCategory: "positive",
    colorWeight: 100
  });
  assert.deepEqual(stationProperties({properties: value => ({colorCategory: value.kind, colorWeight: 7})}, {kind: "custom"}), {
    colorCategory: "custom",
    colorWeight: 7
  });
});

test("heatmapColor increases visibility without making overlapping layers opaque", () => {
  assert.deepEqual(heatmapColor("positive-strong"), [
    "interpolate", ["linear"], ["heatmap-density"],
    0, "rgba(8,127,91,0)",
    0.08, "rgba(8,127,91,0.1)",
    0.25, "rgba(8,127,91,0.26)",
    0.5, "rgba(8,127,91,0.44)",
    1, "rgba(8,127,91,0.68)"
  ]);
});
