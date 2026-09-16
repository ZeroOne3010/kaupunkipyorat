(function (root) {
  function parse(payload, year) {
    if (payload?.v !== 1 || payload.year !== year || typeof payload.domain !== "number" || !payload.stations) return null;
    const stations = new Map(Object.entries(payload.stations).map(([id, value]) => [Number(id), {
      ...value, available: typeof value.value === "number" && typeof value.normalized === "number"
    }]));
    return {domain: payload.domain, stations};
  }

  root.WeatherSensitivity = {parse};
  if (typeof module !== "undefined") module.exports = root.WeatherSensitivity;
})(typeof globalThis !== "undefined" ? globalThis : this);
