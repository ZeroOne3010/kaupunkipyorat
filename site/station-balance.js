(function (root) {
  const StationStyle = root.StationStyle || (typeof require !== "undefined" ? require("./station-style.js") : null);

  function stationBalances(stations, tuples) {
    const balances = new Map(stations.map(([id]) => [id, {arrivals: 0, departures: 0, roundTrips: 0}]));

    tuples.forEach(([origin, destination, count]) => {
      if (balances.has(origin)) balances.get(origin).departures += count;
      if (balances.has(destination)) balances.get(destination).arrivals += count;
      if (origin === destination && balances.has(origin)) balances.get(origin).roundTrips += count;
    });

    return balances;
  }

  function stationBusyness({arrivals, departures, roundTrips = 0}) {
    return arrivals + departures - roundTrips;
  }

  function balanceCategory({arrivals, departures}) {
    const activity = arrivals + departures;
    const relativeDifference = activity ? (arrivals - departures) / activity : 0;
    return StationStyle.divergingCategory(relativeDifference);
  }

  const api = {stationBalances, stationBusyness, balanceCategory};
  root.StationBalance = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
