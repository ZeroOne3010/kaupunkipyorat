const test = require("node:test");
const assert = require("node:assert/strict");
const {divergingCategory, flowBalanceMetric, stationProperties, heatmapColor} = require("./station-style.js");

test("divergingCategory supports configurable, symmetric bands", () => {
  assert.equal(divergingCategory(0.1, [0.1, 0.2, 0.4]), "neutral");
  assert.equal(divergingCategory(-0.11, [0.1, 0.2, 0.4]), "negative-low");
  assert.equal(divergingCategory(0.3, [0.1, 0.2, 0.4]), "positive");
  assert.equal(divergingCategory(-0.5, [0.1, 0.2, 0.4]), "negative-strong");
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

test("heatmapColor keeps category layers translucent across the density ramp", () => {
  assert.deepEqual(heatmapColor("positive-strong"), [
    "interpolate", ["linear"], ["heatmap-density"],
    0, "rgba(8,127,91,0)",
    0.08, "rgba(8,127,91,0.05)",
    0.25, "rgba(8,127,91,0.18)",
    0.5, "rgba(8,127,91,0.38)",
    1, "rgba(8,127,91,0.65)"
  ]);
});
