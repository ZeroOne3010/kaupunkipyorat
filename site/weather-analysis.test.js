const test = require("node:test");
const assert = require("node:assert/strict");
const {observations, summarize, tooltip} = require("./weather-analysis.js");

const history = {daily: [
  {busyness: 100}, {busyness: 200}, {busyness: 300}, {busyness: 400}
]};
const weather = [
  {temperature: 9, minimumTemperature: 4, maximumTemperature: 12, precipitation: 0},
  {temperature: 12, minimumTemperature: 8, maximumTemperature: 15, precipitation: .5},
  {temperature: 17, minimumTemperature: null, maximumTemperature: 20, precipitation: .6},
  {temperature: null, minimumTemperature: null, maximumTemperature: null, precipitation: null}
];

test("builds one defensive observation per calendar day", () => {
  const days = observations(history, weather, 2025, 8);
  assert.equal(days.length, 4);
  assert.deepEqual(days[0], {date: "2025-08-01", rideCount: 100, meanTempC: 9, minTempC: 4, maxTempC: 12, precipitationMm: 0, isWeekend: false});
  assert.equal(days[1].isWeekend, true);
  assert.equal(days[3].meanTempC, null);
  assert.equal(days[3].precipitationMm, null);
});

test("uses the rain threshold and excludes only missing metrics", () => {
  const result = summarize(observations(history, weather, 2025, 8));
  assert.deepEqual(result.dry, {count: 2, average: 150});
  assert.deepEqual(result.rainy, {count: 1, average: 300});
  assert.equal(result.difference, 100);
  assert.deepEqual(result.bands.map(({label, count, average}) => [label, count, average]), [
    ["<10°", 1, 100], ["10–15°", 1, 200], ["15–20°", 1, 300], ["20°+", 0, null]
  ]);
});

test("weekday filtering uses actual UTC calendar dates for every result", () => {
  const result = summarize(observations(history, weather, 2025, 8), true);
  assert.deepEqual(result.days.map(day => day.date), ["2025-08-01", "2025-08-04"]);
  assert.deepEqual(result.dry, {count: 1, average: 100});
  assert.deepEqual(result.rainy, {count: 0, average: null});
  assert.equal(result.difference, null);
});

test("tooltip omits missing weather without leaking invalid values", () => {
  const days = observations(history, weather, 2025, 8);
  assert.match(tooltip(days[0]), /9 °C avg/);
  assert.match(tooltip(days[0]), /4–12 °C/);
  assert.match(tooltip(days[0]), /0\.0 mm precipitation/);
  assert.equal(tooltip(days[3]).includes("null"), false);
});
