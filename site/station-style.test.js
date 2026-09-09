const test = require("node:test");
const assert = require("node:assert/strict");
const {divergingCategory, flowBalanceMetric, stationProperties} = require("./station-style.js");

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
