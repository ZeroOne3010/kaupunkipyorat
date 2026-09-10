(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MonthlyInsights = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const definitions = [
    ["fastest", "Fastest plausible ride"],
    ["longestDistance", "Longest ride"],
    ["longestDuration", "Longest duration"],
    ["shortestDuration", "Quickest ride"],
    ["longestRoundTrip", "Longest round trip"]
  ];

  function duration(seconds) {
    seconds = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const remainder = seconds % 60;
    if (hours) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
    if (minutes && !remainder) return `${minutes} min`;
    return `${minutes} min ${String(remainder).padStart(2, "0")} s`;
  }

  function distance(meters) {
    return `${(Number(meters) / 1000).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})} km`;
  }

  function details(key, ride) {
    const parts = [];
    if (key === "fastest") parts.push(`${(ride.distanceM / ride.durationS * 3.6).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})} km/h`);
    parts.push(distance(ride.distanceM), duration(ride.durationS));
    return parts.join(" · ");
  }

  function records(data) {
    return definitions.flatMap(([key, label]) => {
      if (!data || !data[key]) return [];
      const rides = Array.isArray(data[key]) ? data[key] : [data[key]];
      return rides.map((ride, index) => ({key, id: `${key}:${index}`, rank: index + 1, label, ...ride}));
    });
  }

  return {definitions, details, distance, duration, records};
});
