const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {monthlyHistory, dailyHistory, timeAwareHistory, navigationSelection, seasonHistory} = require("./station-profile.js");

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
  assert.deepEqual(history[0], {hour: 0, arrivals: 8, departures: 6, netFlow: 2});
  assert.deepEqual(history[1], {hour: 1, arrivals: 0, departures: 0, netFlow: 0});
  assert.deepEqual(history[2], {hour: 2, arrivals: 0, departures: 7, netFlow: -7});
});

test("time-aware history selects monthly days and the selected day's hours", () => {
  const d = Array.from({length: 30}, () => []);
  const h = Array.from({length: 30 * 24}, () => []);
  d[1] = [[2, 1, 9]];
  h[24 + 6] = [[1, 2, 4], [2, 1, 7]];
  const monthData = {y: 2025, m: 4, d, h};
  const date = new Date(Date.UTC(2025, 3, 2, 6));

  assert.equal(timeAwareHistory("month", 1, monthData, date)[1].arrivals, 9);
  assert.deepEqual(timeAwareHistory("day", 1, monthData, date)[6], {hour: 6, arrivals: 7, departures: 4, netFlow: 3});
  assert.deepEqual(timeAwareHistory("hour", 1, monthData, date)[6], {hour: 6, arrivals: 7, departures: 4, netFlow: 3});
});

test("chart navigation selects a day or hour without changing the station", () => {
  const initial = new Date(Date.UTC(2025, 3, 10, 5));
  const day = navigationSelection(initial, 42, "day", 22);
  const hour = navigationSelection(day.selectedDate, day.selectedStationId, "hour", 17);

  assert.equal(day.selectedDate.toISOString(), "2025-04-22T05:00:00.000Z");
  assert.equal(day.mode, "day");
  assert.equal(hour.selectedDate.toISOString(), "2025-04-22T17:00:00.000Z");
  assert.equal(hour.mode, "hour");
  assert.equal(hour.selectedStationId, 42);
  assert.equal(initial.toISOString(), "2025-04-10T05:00:00.000Z");
});

test("station profile charts remain alongside the main station history chart", () => {
  const html = fs.readFileSync(require.resolve("./index.html"), "utf8");
  assert.match(html, /id="station-history-chart"/);
  assert.match(html, /id="profile-daily-chart"/);
  assert.match(html, /id="profile-hourly-chart"/);
  assert.match(html, /id="profile-net-chart"/);
  assert.match(html, />Activity by day</);
  assert.match(html, />Typical day</);
  assert.match(html, />Net flow by day</);
});

test("season history aggregates station flows into points exactly one week apart", () => {
  const april = Array.from({length: 30}, () => []);
  const may = Array.from({length: 31}, () => []);
  april[0] = [[2, 1, 5], [1, 3, 2]];
  april[6] = [[2, 1, 3]];
  april[7] = [[1, 3, 4]];
  may[0] = [[2, 1, 7]];

  const history = seasonHistory(1, [{y: 2025, m: 5, d: may, h: []}, {y: 2025, m: 4, d: april, h: []}]);

  assert.equal(history.length, 9);
  assert.equal(history[0].date.toISOString(), "2025-04-01T00:00:00.000Z");
  assert.equal(history[1].date.toISOString(), "2025-04-08T00:00:00.000Z");
  assert.deepEqual({...history[0], date: undefined}, {date: undefined, arrivals: 8, departures: 2, netFlow: 6});
  assert.deepEqual({...history[1], date: undefined}, {date: undefined, arrivals: 0, departures: 4, netFlow: -4});
  assert.equal(history[4].arrivals, 7);
});
