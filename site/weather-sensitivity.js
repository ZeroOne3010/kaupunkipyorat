(function (root) {
  const SEASON_MONTHS = [4, 5, 6, 7, 8, 9, 10];
  const MINIMUM_DAYS = 10;

  function percentile(values, fraction) {
    if (!values.length) return 1;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] || 1;
  }

  function createAccumulator(stations, weather, year, cityForLongitude) {
    const samples = new Map(stations.map(([id]) => [id, {dryCount: 0, drySum: 0, rainyCount: 0, rainySum: 0}]));
    function addMonth(month, payload) {
      if (!payload?.d) return false;
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
          const group = precipitation > .5 ? "rainy" : "dry";
          const sample = samples.get(id);
          sample[`${group}Count`]++;
          sample[`${group}Sum`] += rides.get(id);
        });
      });
      return true;
    }
    function finish() {
      const result = new Map();
      samples.forEach((groups, id) => {
        const dryAverage = groups.dryCount ? groups.drySum / groups.dryCount : null;
        const rainyAverage = groups.rainyCount ? groups.rainySum / groups.rainyCount : null;
        const available = groups.dryCount >= MINIMUM_DAYS && groups.rainyCount >= MINIMUM_DAYS && dryAverage > 0;
        result.set(id, {available, dryCount: groups.dryCount, rainyCount: groups.rainyCount,
          dryAverage, rainyAverage, value: available ? (rainyAverage - dryAverage) / dryAverage * 100 : null});
      });
      const domain = percentile([...result.values()].filter(value => value.available).map(value => Math.abs(value.value)), .9);
      result.forEach(value => { value.normalized = value.available ? Math.max(-1, Math.min(1, value.value / domain)) : null; });
      return {stations: result, domain};
    }
    return {addMonth, finish};
  }

  function calculate(stations, monthlyData, weather, year, cityForLongitude) {
    const accumulator = createAccumulator(stations, weather, year, cityForLongitude);
    SEASON_MONTHS.forEach(month => accumulator.addMonth(month, monthlyData.get(month)));
    return accumulator.finish();
  }

  root.WeatherSensitivity = {SEASON_MONTHS, MINIMUM_DAYS, createAccumulator, calculate, percentile};
  if (typeof module !== "undefined") module.exports = root.WeatherSensitivity;
})(typeof globalThis !== "undefined" ? globalThis : this);
