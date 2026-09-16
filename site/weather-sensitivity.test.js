const test = require("node:test");
const assert = require("node:assert/strict");
const WeatherSensitivity = require("./weather-sensitivity");

test("calculates seasonal station busyness with rain threshold and same-station trips once", () => {
  const stations = [[1, "West", 60, 24], [2, "East", 60, 25]];
  const days = Array.from({length: 20}, (_, day) => [[1, 1, day < 10 ? 5 : 10], [1, 2, day < 10 ? 5 : 10]]);
  const monthly = new Map([[4, {d: days}], ...WeatherSensitivity.SEASON_MONTHS.slice(1).map(month => [month, {d: []}])]);
  const cityDays = Object.fromEntries(days.map((_, index) => [`2025-04-${String(index + 1).padStart(2, "0")}`, {d: [0, 0, 0, index < 10 ? 0.5 : 1]}]));
  const weather = {cities: {espoo: {days: cityDays}, helsinki: {days: cityDays}}};
  const result = WeatherSensitivity.calculate(stations, monthly, weather, 2025, lon => lon < 24.5 ? "espoo" : "helsinki");
  assert.deepEqual(result.stations.get(1), {available: true, dryCount: 10, rainyCount: 10, dryAverage: 10, rainyAverage: 20, value: 100, normalized: 1});
  assert.equal(result.stations.get(2).value, 100);
});

test("marks insufficient and missing precipitation samples unavailable", () => {
  const stations = [[1, "Station", 60, 25]];
  const monthly = new Map([[4, {d: Array.from({length: 19}, () => [])}]]);
  const days = Object.fromEntries(Array.from({length: 19}, (_, index) => [`2025-04-${String(index + 1).padStart(2, "0")}`, {d: [0, 0, 0, index === 18 ? null : index < 9 ? 1 : 0]}]));
  const result = WeatherSensitivity.calculate(stations, monthly, {cities: {helsinki: {days}}}, 2025, () => "helsinki").stations.get(1);
  assert.equal(result.available, false);
  assert.equal(result.value, null);
  assert.deepEqual([result.dryCount, result.rainyCount], [9, 9]);
});

test("supports incremental monthly processing without retaining aggregate payloads", () => {
  const station = [[1, "Station", 60, 25]];
  const days = Object.fromEntries(Array.from({length: 20}, (_, index) => [`2025-04-${String(index + 1).padStart(2, "0")}`, {d: [0, 0, 0, index < 10 ? 0 : 1]}]));
  const accumulator = WeatherSensitivity.createAccumulator(station, {cities: {helsinki: {days}}}, 2025, () => "helsinki");
  assert.equal(accumulator.addMonth(4, {d: Array.from({length: 20}, () => [[1, 1, 2]])}), true);
  assert.equal(accumulator.finish().stations.get(1).value, 0);
});
