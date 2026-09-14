const test = require("node:test");
const assert = require("node:assert/strict");
const {observations, summarize, periodLabel, availablePeriodTarget, tooltip, trapFocus} = require("./weather-analysis.js");

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

test("focus wraps at both ends of the weather dialog", () => {
  const first = {hidden: false, getAttribute: () => null, focus() { this.focused = true; }};
  const last = {hidden: false, getAttribute: () => null, focus() { this.focused = true; }};
  const panel = {querySelectorAll: () => [first, last], contains: element => element === first || element === last};
  const forward = {key: "Tab", shiftKey: false, preventDefault() { this.prevented = true; }};
  assert.equal(trapFocus(panel, forward, last), true);
  assert.equal(forward.prevented, true);
  assert.equal(first.focused, true);

  const backward = {key: "Tab", shiftKey: true, preventDefault() { this.prevented = true; }};
  assert.equal(trapFocus(panel, backward, first), true);
  assert.equal(backward.prevented, true);
  assert.equal(last.focused, true);
});

test("focus trap recovers focus that starts outside the dialog", () => {
  const first = {hidden: false, getAttribute: () => null, focus() { this.focused = true; }};
  const panel = {querySelectorAll: () => [first], contains: () => false};
  const event = {key: "Tab", shiftKey: false, preventDefault() { this.prevented = true; }};
  assert.equal(trapFocus(panel, event, {}), true);
  assert.equal(event.prevented, true);
  assert.equal(first.focused, true);
});

test("formats month and season periods", () => {
  assert.equal(periodLabel("month", 2025, 6, "en"), "June 2025");
  assert.equal(periodLabel("season", 2025, 6, "en"), "Apr–Oct 2025");
});

test("period navigation does not skip unavailable months or years", () => {
  const months = ["2024-04", "2025-05", "2025-06", "2026-10"];
  assert.deepEqual(availablePeriodTarget("month", 2025, 6, -1, months), {year: 2025, month: 5});
  assert.equal(availablePeriodTarget("month", 2025, 6, 1, months), null);
  assert.deepEqual(availablePeriodTarget("season", 2025, 6, -1, months), {year: 2024, month: 6});
  assert.deepEqual(availablePeriodTarget("season", 2025, 6, 1, months), {year: 2026, month: 6});
});

test("season observations remain one observation per valid ride day", () => {
  const april = observations({daily: [{busyness: 10}]}, [{temperature: 8}], 2025, 4);
  const may = observations({daily: [{busyness: 20}, {busyness: 30}]}, [{temperature: 12}, {temperature: 13}], 2025, 5);
  assert.deepEqual([...april, ...may].map(day => day.date), ["2025-04-01", "2025-05-01", "2025-05-02"]);
});
