const test = require("node:test");
const assert = require("node:assert/strict");
const {monthlyHistory} = require("./station-profile.js");

test("monthly history includes every day and all hours with shared station semantics", () => {
  const d = Array.from({length: 31}, () => []);
  const h = Array.from({length: 31 * 24}, () => []);
  d[0] = [[1, 2, 3], [2, 1, 5], [1, 1, 2]];
  d[2] = [[1, 3, 4]];
  h[8] = [[1, 2, 3], [2, 1, 5], [1, 1, 2]];
  h[24 + 8] = [[1, 3, 7], [3, 1, 11]];

  const history = monthlyHistory(1, {y: 2025, m: 10, d, h});

  assert.equal(history.daily.length, 31);
  assert.deepEqual(history.daily[0], {day: 1, arrivals: 7, departures: 5, roundTrips: 2, busyness: 10, netFlow: 2});
  assert.equal(history.daily[1].busyness, 0);
  assert.equal(history.daily[2].busyness, 4);
  assert.equal(history.hourlyTypical.length, 24);
  assert.deepEqual(history.hourlyTypical[8], {hour: 8, arrivals: 18, departures: 12});
  assert.deepEqual(history.hourlyTypical[0], {hour: 0, arrivals: 0, departures: 0});
});

test("monthly history uses the calendar length from the data month", () => {
  assert.equal(monthlyHistory(1, {y: 2024, m: 2, d: [], h: []}).daily.length, 29);
  assert.equal(monthlyHistory(1, {y: 2025, m: 2, d: [], h: []}).daily.length, 28);
});
