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

  function colorWithOpacity(color, opacity) {
    const channels = color.match(/[a-f\d]{2}/gi).map(channel => parseInt(channel, 16));
    return `rgba(${channels.join(",")},${opacity})`;
  }

  function heatmapColor(category) {
    const color = COLORS[category];
    // Keep the upper ramp translucent because each category is rendered as a
    // separate layer. A high alpha here lets the last overlapping layer hide
    // the categories below it; lift the sparse and mid-density stops instead.
    return ["interpolate", ["linear"], ["heatmap-density"],
      0, colorWithOpacity(color, 0),
      0.08, colorWithOpacity(color, 0.1),
      0.25, colorWithOpacity(color, 0.26),
      0.5, colorWithOpacity(color, 0.44),
      1, colorWithOpacity(color, 0.68)
    ];
  }

  const api = {COLORS, divergingCategory, flowBalanceMetric, stationProperties, heatmapColor};
  root.StationStyle = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
