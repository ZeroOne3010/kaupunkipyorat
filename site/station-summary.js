(function (root) {
  function aggregateStationStatistics(stations, tuples) {
    const statistics = new Map(stations.map(station => {
      const id = Array.isArray(station) ? station[0] : station;
      return [id, {id, trips: 0, arrivals: 0, departures: 0, roundTrips: 0,
        totalDurationSeconds: 0, totalDistanceMeters: 0, counterparts: new Map(), destinations: new Set(), origins: new Set()}];
    }));

    tuples.forEach(([origin, destination, count, duration = 0, distance = 0]) => {
      const originStats = statistics.get(origin);
      const destinationStats = statistics.get(destination);
      if (originStats) {
        originStats.departures += count;
        originStats.trips += count;
        originStats.totalDurationSeconds += duration;
        originStats.totalDistanceMeters += distance;
        if (origin === destination) originStats.roundTrips += count;
        else if (destinationStats && count > 0) {
          originStats.counterparts.set(destination, (originStats.counterparts.get(destination) || 0) + count);
          originStats.destinations.add(destination);
        }
      }
      if (destinationStats) {
        destinationStats.arrivals += count;
        if (destination !== origin) {
          destinationStats.trips += count;
          destinationStats.totalDurationSeconds += duration;
          destinationStats.totalDistanceMeters += distance;
          if (originStats && count > 0) {
            destinationStats.counterparts.set(origin, (destinationStats.counterparts.get(origin) || 0) + count);
            destinationStats.origins.add(origin);
          }
        }
      }
    });
    return statistics;
  }

  function summaryFromStatistics(stats) {
    const trips = stats?.trips || 0;
    const departures = stats?.departures || 0;
    return {
      trips,
      arrivals: stats?.arrivals || 0,
      departures,
      uniqueDestinations: stats ? stats.destinations.size : 0,
      uniqueOrigins: stats ? stats.origins.size : 0,
      averageDurationSeconds: trips ? stats.totalDurationSeconds / trips : 0,
      averageDistanceMeters: trips ? stats.totalDistanceMeters / trips : 0,
      averageSpeedKmh: stats?.totalDurationSeconds ? stats.totalDistanceMeters / stats.totalDurationSeconds * 3.6 : 0,
      roundTrips: stats?.roundTrips || 0,
      roundTripPercentage: departures ? stats.roundTrips / departures * 100 : 0
    };
  }

  function stationSummary(stationId, tuples) {
    const ids = new Set([stationId]);
    tuples.forEach(([origin, destination]) => { ids.add(origin); ids.add(destination); });
    return summaryFromStatistics(aggregateStationStatistics([...ids], tuples).get(stationId));
  }

  function busiestStationRank(stationId, stationIds, tuples) {
    const statistics = aggregateStationStatistics(stationIds, tuples);
    const activity = [...statistics.values()].map(stats => stats.trips);
    const selectedActivity = statistics.get(stationId)?.trips || 0;
    return {
      rank: 1 + activity.filter(total => total > selectedActivity).length,
      total: statistics.size
    };
  }

  function stationRankings(statistics, minimumBusyness = 20) {
    const entries = [...statistics.values()].map(stats => {
      const top = [...stats.counterparts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      return {...stats, connected: stats.counterparts.size, topCounterpartId: top?.[0], topCounterpartTrips: top?.[1] || 0,
        roundTripShare: stats.trips ? stats.roundTrips / stats.trips : 0,
        concentration: stats.trips ? (top?.[1] || 0) / stats.trips : 0,
        averageDistanceMeters: stats.trips ? stats.totalDistanceMeters / stats.trips : 0,
        averageDurationSeconds: stats.trips ? stats.totalDurationSeconds / stats.trips : 0};
    });
    const sorted = (items, property) => items.sort((a, b) => b[property] - a[property] || a.id - b.id);
    const qualified = entries.filter(stats => stats.trips >= minimumBusyness);
    return {
      busiest: sorted(entries, "trips"),
      roundTrips: sorted([...qualified], "roundTripShare"),
      connected: sorted(entries.filter(stats => stats.connected > 0), "connected"),
      concentrated: sorted(qualified.filter(stats => stats.topCounterpartId !== undefined), "concentration"),
      distance: sorted([...qualified], "averageDistanceMeters"),
      duration: sorted([...qualified], "averageDurationSeconds")
    };
  }

  function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    const remainingMinutes = minutes % 60;
    return `${Math.floor(minutes / 60)} h${remainingMinutes ? ` ${String(remainingMinutes).padStart(2, "0")} min` : ""}`;
  }

  function formatPeriod(period, trips) {
    const compactPeriod = period
      .replace(/^([^,]+), /, "$1 ")
      .replace(" · ", ", ");
    return `${compactPeriod} · ${trips.toLocaleString()} trips`;
  }

  function formatNetFlow(arrivals, departures) {
    const difference = arrivals - departures;
    const percentage = arrivals + departures ? difference / (arrivals + departures) * 100 : 0;
    const signedDifference = `${difference > 0 ? "+" : ""}${difference.toLocaleString()}`;
    const signedPercentage = `${percentage > 0 ? "+" : ""}${percentage.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}%`;
    return `Net flow ${signedDifference} (${signedPercentage})`;
  }

  const api = {aggregateStationStatistics, summaryFromStatistics, stationRankings, stationSummary, busiestStationRank, formatDuration, formatPeriod, formatNetFlow};
  root.StationSummary = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
