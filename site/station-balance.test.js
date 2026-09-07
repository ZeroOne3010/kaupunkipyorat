const test = require("node:test");
const assert = require("node:assert/strict");
const {stationBalances, balanceCategory} = require("./station-balance.js");

test("stationBalances counts arrivals and departures for known stations", () => {
  const balances = stationBalances([[1], [2], [3]], [
    [1, 2, 5],
    [3, 1, 2],
    [1, 99, 4],
    [99, 2, 3]
  ]);

  assert.deepEqual(balances.get(1), {arrivals: 2, departures: 9});
  assert.deepEqual(balances.get(2), {arrivals: 8, departures: 0});
  assert.deepEqual(balances.get(3), {arrivals: 0, departures: 2});
});

test("balanceCategory uses neutral, moderate, and strong bands", () => {
  assert.equal(balanceCategory({arrivals: 0, departures: 0}), "neutral");
  assert.equal(balanceCategory({arrivals: 52, departures: 48}), "neutral");
  assert.equal(balanceCategory({arrivals: 60, departures: 40}), "positive");
  assert.equal(balanceCategory({arrivals: 70, departures: 30}), "positive-strong");
  assert.equal(balanceCategory({arrivals: 40, departures: 60}), "negative");
  assert.equal(balanceCategory({arrivals: 30, departures: 70}), "negative-strong");
});
