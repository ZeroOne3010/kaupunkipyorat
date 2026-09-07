(function (root) {
  function stationSummary(stationId, tuples) {
    const destinationIds = new Set();
    const originIds = new Set();
    let trips = 0;
    let arrivals = 0;
    let departures = 0;
    let outgoingDurationSeconds = 0;
    let outgoingDistanceMeters = 0;
    let roundTrips = 0;

    tuples.forEach(([origin, destination, count, duration = 0, distance = 0]) => {
      const outgoing = origin === stationId;
      const incoming = destination === stationId;
      if (outgoing || incoming) trips += count;
      if (outgoing) {
        departures += count;
        outgoingDurationSeconds += duration;
        outgoingDistanceMeters += distance;
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
      averageDurationSeconds: departures ? outgoingDurationSeconds / departures : 0,
      averageDistanceMeters: departures ? outgoingDistanceMeters / departures : 0,
      roundTrips,
      roundTripPercentage: departures ? roundTrips / departures * 100 : 0
    };
  }

  function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    const remainingMinutes = minutes % 60;
    return `${Math.floor(minutes / 60)} h${remainingMinutes ? ` ${String(remainingMinutes).padStart(2, "0")} min` : ""}`;
  }

  const api = {stationSummary, formatDuration};
  root.StationSummary = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
