const test = require("node:test");
const assert = require("node:assert/strict");
const {ESPOO_LONGITUDE_LIMIT, cityForLongitude, weatherForSelection, displayParts} = require("./weather.js");

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
