const test = require("node:test");
const assert = require("node:assert/strict");
const {aggregateStationStatistics, stationRankings, stationSummary, busiestStationRank, formatDuration, formatPeriod, formatNetFlow} = require("./station-summary.js");

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

test("shared station statistics derive all six rankings without double-counting round trips", () => {
  const statistics = aggregateStationStatistics([[1], [2], [3]], [
    [1, 2, 15, 9000, 45000],
    [2, 1, 10, 4000, 20000],
    [1, 1, 5, 500, 500],
    [2, 3, 10, 12000, 60000]
  ]);
  const rankings = stationRankings(statistics, 20);

  assert.equal(statistics.get(1).trips, 30);
  assert.equal(statistics.get(1).roundTrips, 5);
  assert.equal(statistics.get(1).counterparts.get(2), 25);
  assert.equal(rankings.busiest[0].id, 2);
  assert.equal(rankings.roundTrips[0].id, 1);
  assert.equal(rankings.connected[0].id, 2);
  assert.equal(rankings.concentrated[0].id, 1);
  assert.equal(rankings.distance[0].id, 2);
  assert.equal(rankings.duration[0].id, 2);
});

test("ratio and average rankings enforce minimum activity", () => {
  const rankings = stationRankings(aggregateStationStatistics([[1], [2], [3]], [[1, 2, 19, 190, 1900]]), 20);

  assert.equal(rankings.busiest.length, 2);
  assert.deepEqual(rankings.busiest.map(stats => stats.id), [1, 2]);
  assert.equal(rankings.connected.length, 2);
  assert.equal(rankings.roundTrips.length, 0);
  assert.equal(rankings.concentrated.length, 0);
  assert.equal(rankings.distance.length, 0);
  assert.equal(rankings.duration.length, 0);
});

test("formatDuration produces compact minute and hour labels", () => {
  assert.equal(formatDuration(840), "14 min");
  assert.equal(formatDuration(4080), "1 h 08 min");
  assert.equal(formatDuration(7200), "2 h");
});

test("formatPeriod combines the selected period and trip count", () => {
  assert.equal(formatPeriod("Wednesday, 1 October 2025 · 00:00–01:00", 3), "Wednesday 1 October 2025, 00:00–01:00 · 3 trips");
});

test("formatNetFlow shows the signed absolute and percentage balance", () => {
  assert.equal(formatNetFlow(219, 227), "Net flow -8 (-1.8%)");
  assert.equal(formatNetFlow(227, 219), "Net flow +8 (+1.8%)");
  assert.equal(formatNetFlow(0, 0), "Net flow 0 (0.0%)");
});
