(function (root) {
  function stationBalances(stations, tuples) {
    const balances = new Map(stations.map(([id]) => [id, {arrivals: 0, departures: 0}]));

    tuples.forEach(([origin, destination, count]) => {
      if (balances.has(origin)) balances.get(origin).departures += count;
      if (balances.has(destination)) balances.get(destination).arrivals += count;
    });

    return balances;
  }

  function balanceCategory({arrivals, departures}) {
    const activity = arrivals + departures;
    if (!activity) return "neutral";

    const relativeDifference = (arrivals - departures) / activity;
    if (Math.abs(relativeDifference) <= 0.1) return "neutral";
    if (relativeDifference > 0.3) return "positive-strong";
    if (relativeDifference > 0) return "positive";
    if (relativeDifference < -0.3) return "negative-strong";
    return "negative";
  }

  const api = {stationBalances, balanceCategory};
  root.StationBalance = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
