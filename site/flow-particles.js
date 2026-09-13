(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FlowParticles = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  const EARTH_RADIUS_METERS = 6371000;

  function distanceMeters(a, b) {
    const radians = Math.PI / 180;
    const latitudeDelta = (b[1] - a[1]) * radians;
    const longitudeDelta = (b[0] - a[0]) * radians;
    const latitude1 = a[1] * radians;
    const latitude2 = b[1] * radians;
    const sinLatitude = Math.sin(latitudeDelta / 2);
    const sinLongitude = Math.sin(longitudeDelta / 2);
    const value = sinLatitude * sinLatitude + Math.cos(latitude1) * Math.cos(latitude2) * sinLongitude * sinLongitude;
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(value)));
  }

  function preparePath(coordinates) {
    if (!coordinates || coordinates.length < 2) return null;
    const cumulative = new Float64Array(coordinates.length);
    for (let index = 1; index < coordinates.length; index += 1) {
      cumulative[index] = cumulative[index - 1] + distanceMeters(coordinates[index - 1], coordinates[index]);
    }
    const totalLength = cumulative[cumulative.length - 1];
    return totalLength > 0 ? {coordinates, cumulative, totalLength} : null;
  }

  function allocateCounts(flows, cap) {
    const counts = new Array(flows.length).fill(0);
    if (!flows.length || cap < 1) return counts;
    const order = flows.map((flow, index) => ({index, weight: Math.sqrt(Math.max(0, flow.count || 0))}))
      .filter(item => item.weight > 0).sort((a, b) => b.weight - a.weight);
    const totalWeight = order.reduce((sum, item) => sum + item.weight, 0);
    const budget = Math.min(cap, Math.max(order.length, Math.ceil(totalWeight)));
    const baseCount = Math.min(budget, order.length);
    for (let index = 0; index < baseCount; index += 1) counts[order[index].index] = 1;
    let remaining = budget - baseCount;
    if (!remaining || !order.length) return counts;
    const proportionalCount = remaining;
    const fractions = [];
    order.forEach(item => {
      const exact = proportionalCount * item.weight / totalWeight;
      const whole = Math.floor(exact);
      counts[item.index] += whole;
      fractions.push({index: item.index, fraction: exact - whole});
    });
    remaining = budget - counts.reduce((sum, count) => sum + count, 0);
    fractions.sort((a, b) => b.fraction - a.fraction);
    for (let index = 0; index < remaining; index += 1) counts[fractions[index % fractions.length].index] += 1;
    return counts;
  }

  function positionAt(path, distance, output) {
    const target = ((distance % path.totalLength) + path.totalLength) % path.totalLength;
    let low = 1;
    let high = path.cumulative.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (path.cumulative[middle] < target) low = middle + 1;
      else high = middle;
    }
    const startDistance = path.cumulative[low - 1];
    const segmentLength = path.cumulative[low] - startDistance;
    const ratio = segmentLength ? (target - startDistance) / segmentLength : 0;
    const start = path.coordinates[low - 1];
    const end = path.coordinates[low];
    output[0] = start[0] + (end[0] - start[0]) * ratio;
    output[1] = start[1] + (end[1] - start[1]) * ratio;
    return output;
  }

  function createParticles(flows, cap) {
    const preparedFlows = flows.map(flow => ({count: flow.count, path: preparePath(flow.coordinates)})).filter(flow => flow.path);
    const allocation = allocateCounts(preparedFlows, cap);
    const particles = [];
    preparedFlows.forEach((flow, flowIndex) => {
      const count = allocation[flowIndex];
      for (let index = 0; index < count; index += 1) {
        const distance = flow.path.totalLength * (index + Math.random()) / count;
        particles.push({path: flow.path, distance});
      }
    });
    return particles;
  }

  return {allocateCounts, createParticles, distanceMeters, positionAt, preparePath};
});
