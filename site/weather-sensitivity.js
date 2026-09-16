(function (root) {
  function parse(payload, year) {
    if (payload?.v !== 1 || payload.year !== year || typeof payload.domain !== "number" || !payload.stations) return null;
    const stations = new Map(Object.entries(payload.stations).map(([id, value]) => [Number(id), {
      ...value, available: typeof value.value === "number" && typeof value.normalized === "number"
    }]));
    return {domain: payload.domain, stations};
  }

  function rankings(stations) {
    const available = [...(stations || new Map()).entries()]
      .filter(([, station]) => station?.available && Number.isFinite(station.value))
      .map(([id, station]) => ({...station, id}));
    const byMagnitude = (a, b) => Math.abs(b.value) - Math.abs(a.value) || a.id - b.id;
    return {
      most: [...available].sort(byMagnitude),
      least: [...available].sort((a, b) => Math.abs(a.value) - Math.abs(b.value) || a.id - b.id)
    };
  }

  root.WeatherSensitivity = {parse, rankings};
  if (typeof module !== "undefined") module.exports = root.WeatherSensitivity;
})(typeof globalThis !== "undefined" ? globalThis : this);
