(function (root) {
  const SEASON_MONTHS = [4, 5, 6, 7, 8, 9, 10];
  const MINIMUM_DAYS = 10;

  function percentile(values, fraction) {
    if (!values.length) return 1;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] || 1;
  }

  function calculate(stations, monthlyData, weather, year, cityForLongitude) {
    const samples = new Map(stations.map(([id]) => [id, {dry: [], rainy: []}]));
    for (const month of SEASON_MONTHS) {
      const payload = monthlyData.get(month);
      if (!payload?.d) continue;
      payload.d.forEach((tuples, dayIndex) => {
        const rides = new Map(stations.map(([id]) => [id, 0]));
        tuples.forEach(([origin, destination, count]) => {
          if (rides.has(origin)) rides.set(origin, rides.get(origin) + count);
          if (destination !== origin && rides.has(destination)) rides.set(destination, rides.get(destination) + count);
        });
        const date = new Date(Date.UTC(year, month - 1, dayIndex + 1)).toISOString().slice(0, 10);
        stations.forEach(([id, , , longitude]) => {
          const precipitation = weather?.cities?.[cityForLongitude(longitude)]?.days?.[date]?.d?.[3];
          if (typeof precipitation !== "number" || !Number.isFinite(precipitation)) return;
          samples.get(id)[precipitation > .5 ? "rainy" : "dry"].push(rides.get(id));
        });
      });
    }
    const result = new Map();
    samples.forEach((groups, id) => {
      const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
      const dryAverage = groups.dry.length ? average(groups.dry) : null;
      const rainyAverage = groups.rainy.length ? average(groups.rainy) : null;
      const available = groups.dry.length >= MINIMUM_DAYS && groups.rainy.length >= MINIMUM_DAYS && dryAverage > 0;
      result.set(id, {available, dryCount: groups.dry.length, rainyCount: groups.rainy.length,
        dryAverage, rainyAverage, value: available ? (rainyAverage - dryAverage) / dryAverage * 100 : null});
    });
    const domain = percentile([...result.values()].filter(value => value.available).map(value => Math.abs(value.value)), .9);
    result.forEach(value => { value.normalized = value.available ? Math.max(-1, Math.min(1, value.value / domain)) : null; });
    return {stations: result, domain};
  }

  root.WeatherSensitivity = {SEASON_MONTHS, MINIMUM_DAYS, calculate, percentile};
  if (typeof module !== "undefined") module.exports = root.WeatherSensitivity;
})(typeof globalThis !== "undefined" ? globalThis : this);
