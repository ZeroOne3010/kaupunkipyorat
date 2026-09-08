(function (root) {
  function stationSummary(stationId, tuples) {
    const destinationIds = new Set();
    const originIds = new Set();
    let trips = 0;
    let arrivals = 0;
    let departures = 0;
    let totalDurationSeconds = 0;
    let totalDistanceMeters = 0;
    let roundTrips = 0;

    tuples.forEach(([origin, destination, count, duration = 0, distance = 0]) => {
      const outgoing = origin === stationId;
      const incoming = destination === stationId;
      if (outgoing || incoming) {
        trips += count;
        totalDurationSeconds += duration;
        totalDistanceMeters += distance;
      }
      if (outgoing) {
        departures += count;
        if (count > 0 && destination !== stationId) destinationIds.add(destination);
      }
      if (incoming) {
        arrivals += count;
        if (count > 0 && origin !== stationId) originIds.add(origin);
      }
      if (outgoing && incoming) roundTrips += count;
    });

    return {
      trips,
      arrivals,
      departures,
      uniqueDestinations: destinationIds.size,
      uniqueOrigins: originIds.size,
      averageDurationSeconds: trips ? totalDurationSeconds / trips : 0,
      averageDistanceMeters: trips ? totalDistanceMeters / trips : 0,
      averageSpeedKmh: totalDurationSeconds ? totalDistanceMeters / totalDurationSeconds * 3.6 : 0,
      roundTrips,
      roundTripPercentage: departures ? roundTrips / departures * 100 : 0
    };
  }

  function busiestStationRank(stationId, stationIds, tuples) {
    const activity = new Map(stationIds.map(id => [id, 0]));
    tuples.forEach(([origin, destination, count]) => {
      if (activity.has(origin)) activity.set(origin, activity.get(origin) + count);
      if (destination !== origin && activity.has(destination)) activity.set(destination, activity.get(destination) + count);
    });
    const selectedActivity = activity.get(stationId) || 0;
    return {
      rank: 1 + [...activity.values()].filter(total => total > selectedActivity).length,
      total: activity.size
    };
  }

  function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    const remainingMinutes = minutes % 60;
    return `${Math.floor(minutes / 60)} h${remainingMinutes ? ` ${String(remainingMinutes).padStart(2, "0")} min` : ""}`;
  }

  const api = {stationSummary, busiestStationRank, formatDuration};
  root.StationSummary = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
