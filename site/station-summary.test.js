const test = require("node:test");
const assert = require("node:assert/strict");
const {stationSummary, formatDuration} = require("./station-summary.js");

test("stationSummary derives weighted outgoing statistics and connection counts", () => {
  const summary = stationSummary(1, [
    [1, 2, 2, 1200, 6000],
    [1, 2, 3, 900, 3000],
    [3, 1, 4, 1600, 8000],
    [1, 1, 1, 600, 1000],
    [1, 99, 1, 300, 2000]
  ]);

  assert.deepEqual(summary, {
    trips: 11,
    arrivals: 5,
    departures: 7,
    uniqueDestinations: 2,
    uniqueOrigins: 1,
    averageDurationSeconds: 428.57142857142856,
    averageDistanceMeters: 1714.2857142857142,
    roundTrips: 1,
    roundTripPercentage: 14.285714285714285
  });
});

test("stationSummary does not count the selected station as a connection", () => {
  const summary = stationSummary(1, [[1, 1, 3, 300, 600]]);

  assert.equal(summary.trips, 3);
  assert.equal(summary.uniqueDestinations, 0);
  assert.equal(summary.uniqueOrigins, 0);
});

test("formatDuration produces compact minute and hour labels", () => {
  assert.equal(formatDuration(840), "14 min");
  assert.equal(formatDuration(4080), "1 h 08 min");
  assert.equal(formatDuration(7200), "2 h");
});
