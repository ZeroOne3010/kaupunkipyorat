(function (root) {
  // Keep sparse periods visually sparse instead of making their busiest ride
  // look as prominent as a busy connection in the full month.
  function rideCountScale(count) {
    return Math.min(1, Math.sqrt(Math.max(0, count) / 100));
  }

  root.FlowStyle = {rideCountScale};
}(typeof window === "undefined" ? globalThis : window));
