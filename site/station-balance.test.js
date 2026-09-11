const test = require("node:test");
const assert = require("node:assert/strict");
const {stationBalances, stationBusyness, balanceCategory} = require("./station-balance.js");

test("stationBalances counts arrivals and departures for known stations", () => {
  const balances = stationBalances([[1], [2], [3]], [
    [1, 2, 5],
    [3, 1, 2],
    [1, 99, 4],
    [99, 2, 3]
  ]);

  assert.deepEqual(balances.get(1), {arrivals: 2, departures: 9, roundTrips: 0});
  assert.deepEqual(balances.get(2), {arrivals: 8, departures: 0, roundTrips: 0});
  assert.deepEqual(balances.get(3), {arrivals: 0, departures: 2, roundTrips: 0});
});

test("station busyness counts a same-station ride once", () => {
  const balances = stationBalances([[1], [2]], [[1, 1, 4], [1, 2, 3]]);
  assert.deepEqual(balances.get(1), {arrivals: 4, departures: 7, roundTrips: 4});
  assert.equal(stationBusyness(balances.get(1)), 7);
});

test("balanceCategory uses a five percent neutral threshold and three levels per direction", () => {
  assert.equal(balanceCategory({arrivals: 0, departures: 0}), "neutral");
  assert.equal(balanceCategory({arrivals: 52.5, departures: 47.5}), "neutral");
  assert.equal(balanceCategory({arrivals: 53, departures: 47}), "positive-low");
  assert.equal(balanceCategory({arrivals: 47, departures: 53}), "negative-low");
  assert.equal(balanceCategory({arrivals: 60, departures: 40}), "positive");
  assert.equal(balanceCategory({arrivals: 70.5, departures: 29.5}), "positive-strong");
  assert.equal(balanceCategory({arrivals: 40, departures: 60}), "negative");
  assert.equal(balanceCategory({arrivals: 29.5, departures: 70.5}), "negative-strong");
});
