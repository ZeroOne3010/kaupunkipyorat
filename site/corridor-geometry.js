(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CorridorGeometry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  function parse(payload, year, decodePolyline) {
    if (payload?.v !== 1 || payload.year !== year || !Array.isArray(payload.corridors)) return null;
    const features = [];
    for (const row of payload.corridors) {
      if (!Array.isArray(row) || typeof row[0] !== "string" || !Number.isFinite(row[1]) || row[1] < 0) continue;
      try {
        const coordinates = decodePolyline(row[0]);
        if (coordinates.length > 1) features.push({type: "Feature", properties: {trips: row[1]}, geometry: {type: "LineString", coordinates}});
      } catch (_) { /* Ignore a malformed individual line, not the whole season. */ }
    }
    return {year, from: payload.from, to: payload.to,
      geojson: {type: "FeatureCollection", features}};
  }

  function periodLabel(year) { return `Apr–Oct ${year}`; }

  return {parse, periodLabel};
});
