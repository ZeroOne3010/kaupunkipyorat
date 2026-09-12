(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RouteGeometry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  function decodePolyline(encoded, precision = 5) {
    const coordinates = [];
    let latitude = 0;
    let longitude = 0;
    let index = 0;
    const factor = 10 ** precision;
    while (index < encoded.length) {
      const deltas = [];
      for (let coordinate = 0; coordinate < 2; coordinate += 1) {
        let result = 0;
        let shift = 0;
        let byte;
        do {
          if (index >= encoded.length) throw new Error("invalid encoded polyline");
          byte = encoded.charCodeAt(index++) - 63;
          if (byte < 0 || byte > 63) throw new Error("invalid encoded polyline");
          result |= (byte & 0x1f) << shift;
          shift += 5;
        } while (byte >= 0x20);
        deltas.push(result & 1 ? ~(result >> 1) : result >> 1);
      }
      latitude += deltas[0];
      longitude += deltas[1];
      coordinates.push([longitude / factor, latitude / factor]);
    }
    return coordinates;
  }

  function connectionCoordinates(origin, destination, selectedId, routeFile, decodedCache) {
    const straight = [[origin.lon, origin.lat], [destination.lon, destination.lat]];
    if (!routeFile) return straight;
    if (destination.id === selectedId && origin.id !== selectedId) return null;
    if (origin.id !== selectedId) return straight;
    const route = routeFile.out?.[String(destination.id)];
    if (!route?.p) return straight;
    const key = `${origin.id}:${destination.id}:${route.p}`;
    if (!decodedCache.has(key)) {
      try {
        decodedCache.set(key, decodePolyline(route.p));
      } catch (_) {
        return straight;
      }
    }
    return decodedCache.get(key);
  }

  return {decodePolyline, connectionCoordinates};
});
