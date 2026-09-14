const test = require("node:test");
const assert = require("node:assert/strict");
const {monthlyHistory, dailyHistory} = require("./station-profile.js");

test("monthly history includes every day and all hours with shared station semantics", () => {
  const d = Array.from({length: 31}, () => []);
  const h = Array.from({length: 31 * 24}, () => []);
  d[0] = [[1, 2, 3], [2, 1, 5], [1, 1, 2]];
  d[2] = [[1, 3, 4]];
  h[8] = [[1, 2, 3], [2, 1, 5], [1, 1, 2]];
  h[24 + 8] = [[1, 3, 7], [3, 1, 11]];

  const history = monthlyHistory(1, {y: 2025, m: 10, d, h});

  assert.equal(history.daily.length, 31);
  assert.deepEqual(history.daily[0], {day: 1, isWeekend: false, arrivals: 7, departures: 5, roundTrips: 2, busyness: 10, netFlow: 2});
  assert.equal(history.daily[1].busyness, 0);
  assert.equal(history.daily[2].busyness, 4);
  assert.equal(history.hourlyTypical.length, 24);
  assert.deepEqual(history.hourlyTypical[8], {hour: 8, arrivals: 18 / 31, departures: 12 / 31});
  assert.deepEqual(history.hourlyTypical[0], {hour: 0, arrivals: 0, departures: 0});
});

test("typical-day buckets average activity over every represented calendar day", () => {
  const h = Array.from({length: 2 * 24}, () => []);
  h[8] = [[2, 1, 10], [1, 3, 4]];
  h[24 + 8] = [[2, 1, 20], [1, 3, 8]];

  const history = monthlyHistory(1, {y: 2025, m: 2, d: [], h});

  assert.deepEqual(history.hourlyTypical[8], {hour: 8, arrivals: 30 / 28, departures: 12 / 28});
});

test("monthly history uses the calendar length from the data month", () => {
  assert.equal(monthlyHistory(1, {y: 2024, m: 2, d: [], h: []}).daily.length, 29);
  assert.equal(monthlyHistory(1, {y: 2025, m: 2, d: [], h: []}).daily.length, 28);
});

test("monthly history identifies weekends using the data month calendar", () => {
  const history = monthlyHistory(1, {y: 2025, m: 8, d: [], h: []});

  assert.deepEqual(history.daily.filter(day => day.isWeekend).map(day => day.day), [2, 3, 9, 10, 16, 17, 23, 24, 30, 31]);
});

test("daily history keeps all 24 local-hour buckets aligned", () => {
  const h = Array.from({length: 3 * 24}, () => []);
  h[24] = [[1, 2, 4], [3, 1, 6], [1, 1, 2]];
  h[26] = [[1, 2, 7]];
  const history = dailyHistory(1, {h}, 2);
  assert.equal(history.length, 24);
  assert.deepEqual(history[0], {hour: 0, arrivals: 8, departures: 6});
  assert.deepEqual(history[1], {hour: 1, arrivals: 0, departures: 0});
  assert.deepEqual(history[2], {hour: 2, arrivals: 0, departures: 7});
});
