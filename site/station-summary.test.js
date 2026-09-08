const test = require("node:test");
const assert = require("node:assert/strict");
const {stationSummary, busiestStationRank, formatDuration} = require("./station-summary.js");

test("stationSummary derives weighted ride statistics and connection counts", () => {
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
    averageDurationSeconds: 418.1818181818182,
    averageDistanceMeters: 1818.1818181818182,
    averageSpeedKmh: 15.652173913043478,
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

test("stationSummary calculates ride averages and speed over incoming and outgoing rides", () => {
  const summary = stationSummary(1, [
    [1, 2, 2, 1200, 6000],
    [3, 1, 1, 1800, 9000]
  ]);

  assert.equal(summary.averageDurationSeconds, 1000);
  assert.equal(summary.averageDistanceMeters, 5000);
  assert.equal(summary.averageSpeedKmh, 18);
});

test("busiestStationRank ranks activity without counting round trips twice", () => {
  const ranking = busiestStationRank(1, [1, 2, 3, 4], [
    [1, 1, 5],
    [2, 3, 4],
    [2, 1, 2]
  ]);

  assert.deepEqual(ranking, {rank: 1, total: 4});
  assert.deepEqual(busiestStationRank(3, [1, 2, 3, 4], [[1, 2, 4]]), {rank: 3, total: 4});
});

test("formatDuration produces compact minute and hour labels", () => {
  assert.equal(formatDuration(840), "14 min");
  assert.equal(formatDuration(4080), "1 h 08 min");
  assert.equal(formatDuration(7200), "2 h");
});
