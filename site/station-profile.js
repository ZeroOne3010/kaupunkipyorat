(function (root) {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const summaryApi = root.StationSummary || (typeof require !== "undefined" ? require("./station-summary.js") : null);

  function monthlyHistory(stationId, monthData) {
    const dayCount = new Date(Date.UTC(monthData.y, monthData.m, 0)).getUTCDate();
    const daily = Array.from({length: dayCount}, (_, index) => {
      const day = index + 1;
      const weekday = new Date(Date.UTC(monthData.y, monthData.m - 1, day)).getUTCDay();
      return {day, isWeekend: weekday === 0 || weekday === 6, arrivals: 0, departures: 0, roundTrips: 0, busyness: 0, netFlow: 0};
    });
    const hourlyTypical = Array.from({length: 24}, (_, hour) => ({hour, arrivals: 0, departures: 0}));

    (monthData.d || []).slice(0, dayCount).forEach((tuples, dayIndex) => {
      const stats = summaryApi.aggregateStationStatistics([stationId], tuples).get(stationId);
      const day = daily[dayIndex];
      day.arrivals = stats.arrivals;
      day.departures = stats.departures;
      day.roundTrips = stats.roundTrips;
      day.busyness = stats.trips;
      day.netFlow = day.arrivals - day.departures;
    });
    (monthData.h || []).forEach((tuples, index) => {
      const bucket = hourlyTypical[index % 24];
      tuples.forEach(([origin, destination, count]) => {
        if (origin === stationId) bucket.departures += count;
        if (destination === stationId) bucket.arrivals += count;
      });
    });
    hourlyTypical.forEach(bucket => {
      bucket.arrivals /= dayCount;
      bucket.departures /= dayCount;
    });
    return {daily, hourlyTypical};
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  function renderChart(container, options) {
    const width = 640, height = 220, left = 42, right = 10, top = 14, bottom = 31;
    const innerWidth = width - left - right, innerHeight = height - top - bottom;
    const values = options.series.flatMap(series => series.values);
    const minimum = options.centered ? Math.min(0, ...values) : 0;
    const maximum = Math.max(options.centered ? 0 : 1, ...values);
    const extent = maximum - minimum || 1;
    const y = value => top + (maximum - value) / extent * innerHeight;
    const svg = svgElement("svg", {viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": options.label});
    svg.classList.add("history-chart");
    const baseline = y(0);
    const count = options.series[0].values.length;
    const groupWidth = innerWidth / count;
    (options.weekends || []).forEach(index => svg.append(svgElement("rect", {
      x: left + index * groupWidth, y: top, width: groupWidth, height: innerHeight, class: "chart-weekend"
    })));
    svg.append(svgElement("line", {x1: left, x2: width - right, y1: baseline, y2: baseline, class: "chart-baseline"}));
    options.series.forEach((series, seriesIndex) => series.values.forEach((value, index) => {
      const seriesWidth = groupWidth / options.series.length;
      const padding = Math.min(2, seriesWidth * .15);
      const valueY = y(value);
      const bar = svgElement("rect", {
        x: left + index * groupWidth + seriesIndex * seriesWidth + padding,
        y: Math.min(baseline, valueY), width: Math.max(1, seriesWidth - padding * 2),
        height: Math.max(1, Math.abs(valueY - baseline)), class: `chart-bar ${series.className}${value < 0 ? " negative" : value > 0 ? " positive" : " neutral"}`
      });
      svg.append(bar);
    }));
    options.points.forEach((point, index) => {
      const target = svgElement("rect", {x: left + index * groupWidth, y: top, width: groupWidth, height: innerHeight,
        class: "chart-target", tabindex: "0", role: "button", "aria-label": point.tooltip});
      target.dataset.index = index;
      const title = svgElement("title"); title.textContent = point.tooltip; target.append(title);
      target.addEventListener("mouseenter", () => showTooltip(container, target, point.tooltip));
      target.addEventListener("focus", () => showTooltip(container, target, point.tooltip));
      target.addEventListener("mouseleave", () => hideTooltip(container));
      target.addEventListener("blur", () => hideTooltip(container));
      target.addEventListener("click", () => options.onSelect(index));
      target.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); options.onSelect(index); } });
      svg.append(target);
    });
    options.ticks.forEach(([index, label]) => {
      const text = svgElement("text", {x: left + (index + .5) * groupWidth, y: height - 9, class: "chart-axis-label"});
      text.textContent = label; svg.append(text);
    });
    const high = svgElement("text", {x: left - 5, y: top + 5, class: "chart-value-label"}); high.textContent = maximum.toLocaleString();
    svg.append(high);
    if (options.centered) {
      const low = svgElement("text", {x: left - 5, y: height - bottom, class: "chart-value-label"}); low.textContent = minimum.toLocaleString(); svg.append(low);
    }
    container.replaceChildren(svg);
  }

  function showTooltip(container, target, text) {
    let tooltip = container.querySelector(".chart-tooltip");
    if (!tooltip) { tooltip = document.createElement("div"); tooltip.className = "chart-tooltip"; container.append(tooltip); }
    tooltip.textContent = text;
    const chartRect = container.getBoundingClientRect(), targetRect = target.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(chartRect.width - 110, targetRect.left - chartRect.left + targetRect.width / 2))}px`;
    tooltip.hidden = false;
  }
  function hideTooltip(container) { const tooltip = container.querySelector(".chart-tooltip"); if (tooltip) tooltip.hidden = true; }

  function render(container, history, date, callbacks) {
    const dateForDay = day => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), day));
    const dayLabel = day => dateForDay(day).toLocaleDateString(undefined, {weekday: "short", day: "numeric", month: "short", timeZone: "UTC"});
    const dayTicks = history.daily.map((item, index) => [index, item.day]).filter(([index]) => index === 0 || (index + 1) % 5 === 0 || index === history.daily.length - 1);
    renderChart(container.daily, {label: "Trips by calendar day", series: [{className: "activity", values: history.daily.map(day => day.busyness)}],
      points: history.daily.map(day => ({tooltip: `${dayLabel(day.day)} · ${day.busyness.toLocaleString()} trips`})),
      weekends: history.daily.flatMap((day, index) => day.isWeekend ? [index] : []), ticks: dayTicks, onSelect: index => callbacks.day(history.daily[index].day)});
    const average = value => value.toLocaleString(undefined, {maximumFractionDigits: 1});
    renderChart(container.hourly, {label: "Typical day average arrivals and departures by hour", series: [
      {className: "arrivals", values: history.hourlyTypical.map(hour => hour.arrivals)}, {className: "departures", values: history.hourlyTypical.map(hour => hour.departures)}],
      points: history.hourlyTypical.map(item => ({tooltip: `${String(item.hour).padStart(2, "0")}:00–${String((item.hour + 1) % 24).padStart(2, "0")}:00 · ${average(item.arrivals)} average arrivals · ${average(item.departures)} average departures`})),
      ticks: [0, 4, 8, 12, 16, 20, 23].map(hour => [hour, String(hour).padStart(2, "0")]), onSelect: callbacks.hour});
    renderChart(container.net, {label: "Daily net flow", centered: true, series: [{className: "net", values: history.daily.map(day => day.netFlow)}],
      points: history.daily.map(day => ({tooltip: `${dayLabel(day.day)} · Net flow ${day.netFlow > 0 ? "+" : ""}${day.netFlow.toLocaleString()}`})),
      weekends: history.daily.flatMap((day, index) => day.isWeekend ? [index] : []), ticks: dayTicks, onSelect: index => callbacks.day(history.daily[index].day)});
  }

  root.StationProfile = {monthlyHistory, render};
  if (typeof module !== "undefined") module.exports = {monthlyHistory};
})(typeof globalThis !== "undefined" ? globalThis : this);
