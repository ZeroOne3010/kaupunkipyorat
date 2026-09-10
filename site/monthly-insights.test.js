const assert = require("node:assert/strict");
const test = require("node:test");
const Insights = require("./monthly-insights.js");

test("derives speed and formats compact ride details", () => {
  const text = Insights.details("fastest", {distanceM: 4800, durationS: 630});
  assert.match(text, /27[,.]4 km\/h/);
  assert.match(text, /4[,.]8 km/);
  assert.match(text, /10 min 30 s/);
});

test("returns records in display order and skips missing ones", () => {
  const ride = {origin: 1, destination: 2, distanceM: 800, durationS: 171};
  assert.deepEqual(Insights.records({longestDistance: ride, shortestDuration: ride}).map(item => item.key), ["longestDistance", "shortestDuration"]);
});

test("flattens ranked records and preserves their rank", () => {
  const first = {origin: 1, destination: 2, distanceM: 800, durationS: 171};
  const second = {origin: 3, destination: 4, distanceM: 700, durationS: 180};
  const result = Insights.records({fastest: [first, second]});
  assert.deepEqual(result.map(item => [item.id, item.rank, item.origin]), [["fastest:0", 1, 1], ["fastest:1", 2, 3]]);
});
