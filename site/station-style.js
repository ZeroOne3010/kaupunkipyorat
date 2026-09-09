(function (root) {
  const COLORS = {
    "negative-strong": "#c7384f",
    negative: "#dc6670",
    "negative-low": "#f2b8b5",
    neutral: "#f5f3ed",
    "positive-low": "#9bd4b7",
    positive: "#2f9e72",
    "positive-strong": "#087f5b"
  };

  function divergingCategory(value, thresholds = [0.05, 0.15, 0.3]) {
    const magnitude = Math.abs(value);
    if (magnitude <= thresholds[0]) return "neutral";
    const direction = value > 0 ? "positive" : "negative";
    if (magnitude <= thresholds[1]) return `${direction}-low`;
    if (magnitude <= thresholds[2]) return direction;
    return `${direction}-strong`;
  }

  // A metric owns the conversion from its data to visual properties. Adding a
  // non-flow station view should only require another object with this shape.
  const flowBalanceMetric = {
    properties({arrivals, departures}) {
      const activity = arrivals + departures;
      const value = activity ? (arrivals - departures) / activity : 0;
      return {colorCategory: divergingCategory(value), colorWeight: activity};
    }
  };

  function stationProperties(metric, datum) {
    return metric.properties(datum);
  }

  const api = {COLORS, divergingCategory, flowBalanceMetric, stationProperties};
  root.StationStyle = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
