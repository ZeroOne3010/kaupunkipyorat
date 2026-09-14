const test = require("node:test");
const assert = require("node:assert/strict");
const {ESPOO_LONGITUDE_LIMIT, cityForLongitude, weatherForSelection, hourlyWeatherForDay, dailyWeatherForMonth, displayParts} = require("./weather.js");

const payload = {v: 1, year: 2025, cities: {
  helsinki: {days: {"2025-04-01": {h: [[12.4, 0.7, 5.2, 225], []], d: [12, 8, 16, 4.8, 4.6, 225]}}, months: {"04": [10, 1, 20, 40, 4, 359]}},
  espoo: {days: {"2025-04-01": {h: [[8, null, null, null]], d: [9, 3, 14, 2, 3, 1]}}, months: {"04": [8, 0, 18, 35, 3, 1]}}
}};

test("maps station longitude using the explicit boundary", () => {
  assert.equal(cityForLongitude(ESPOO_LONGITUDE_LIMIT - 0.000001), "espoo");
  assert.equal(cityForLongitude(ESPOO_LONGITUDE_LIMIT), "helsinki");
});

test("looks up hour, day, and precomputed month tuples", () => {
  const date = new Date(Date.UTC(2025, 3, 1, 0));
  assert.deepEqual(weatherForSelection(payload, 25, date, "hour"), [12.4, 0.7, 5.2, 225]);
  assert.deepEqual(weatherForSelection(payload, 25, date, "day"), [12, 8, 16, 4.8, 4.6, 225]);
  assert.deepEqual(weatherForSelection(payload, 25, date, "month"), [10, 1, 20, 40, 4, 359]);
  assert.deepEqual(weatherForSelection(payload, 24, date, "month"), [8, 0, 18, 35, 3, 1]);
});

test("preserves unavailable hours and omits missing measurement text", () => {
  const date = new Date(Date.UTC(2025, 3, 1, 1));
  assert.deepEqual(weatherForSelection(payload, 25, date, "hour"), []);
  assert.equal(displayParts([], "hour"), null);
  assert.deepEqual(displayParts([8, null, null, null], "hour"), {
    temperature: "8.0 °C", precipitation: null, speed: null, direction: null
  });
});

test("hourly day weather preserves missing observations and measurements", () => {
  const date = new Date(Date.UTC(2025, 3, 1, 12));
  const weather = hourlyWeatherForDay(payload, 25, date);

  assert.equal(weather.length, 24);
  assert.deepEqual(weather[0], {temperature: 12.4, precipitation: 0.7});
  assert.deepEqual(weather[1], {temperature: null, precipitation: null});
  assert.deepEqual(weather[23], {temperature: null, precipitation: null});
  assert.deepEqual(hourlyWeatherForDay(payload, 24, date)[0], {temperature: 8, precipitation: null});
});

test("monthly daily weather uses dated precomputed aggregates and preserves missing fields", () => {
  payload.cities.helsinki.days["2025-04-02"] = {d: [13, null, 17, null, 4, 180]};
  const weather = dailyWeatherForMonth(payload, 25, new Date(Date.UTC(2025, 3, 20)));

  assert.equal(weather.length, 30);
  assert.deepEqual(weather[0], {date: "2025-04-01", temperature: 12, minimumTemperature: 8, maximumTemperature: 16, precipitation: 4.8});
  assert.deepEqual(weather[1], {date: "2025-04-02", temperature: 13, minimumTemperature: null, maximumTemperature: 17, precipitation: null});
  assert.deepEqual(weather[29], {date: "2025-04-30", temperature: null, minimumTemperature: null, maximumTemperature: null, precipitation: null});
  assert.equal(dailyWeatherForMonth(payload, 25, new Date(Date.UTC(2024, 3, 1))), null);
});
