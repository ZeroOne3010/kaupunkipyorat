(function (root) {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const finite = value => typeof value === "number" && Number.isFinite(value) ? value : null;

  function observations(history, weather, year, month) {
    if (!history || !Array.isArray(weather)) return null;
    return history.daily.map((ride, index) => {
      const date = new Date(Date.UTC(year, month - 1, index + 1));
      const dayWeather = weather[index] || {};
      return {
        date: date.toISOString().slice(0, 10),
        rideCount: finite(ride?.busyness),
        meanTempC: finite(dayWeather.temperature),
        minTempC: finite(dayWeather.minimumTemperature),
        maxTempC: finite(dayWeather.maximumTemperature),
        precipitationMm: finite(dayWeather.precipitation),
        isWeekend: date.getUTCDay() === 0 || date.getUTCDay() === 6
      };
    }).filter(day => day.rideCount !== null);
  }

  function periodLabel(mode, year, month, locale) {
    if (mode === "season") return `Apr–Oct ${year}`;
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale, {month: "long", year: "numeric", timeZone: "UTC"});
  }

  function availablePeriodTarget(mode, year, month, amount, availableKeys) {
    const available = new Set(availableKeys);
    if (mode === "month") {
      const target = new Date(Date.UTC(year, month - 1 + amount, 1));
      return available.has(`${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}`)
        ? {year: target.getUTCFullYear(), month: target.getUTCMonth() + 1} : null;
    }
    const targetYear = year + amount;
    return [...available].some(key => Number(key.slice(0, 4)) === targetYear && Number(key.slice(5)) >= 4 && Number(key.slice(5)) <= 10)
      ? {year: targetYear, month} : null;
  }

  function summarize(days, weekdaysOnly = false) {
    const filtered = days.filter(day => !weekdaysOnly || !day.isWeekend);
    const wet = filtered.filter(day => day.precipitationMm !== null);
    const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const dry = wet.filter(day => day.precipitationMm <= .5), rainy = wet.filter(day => day.precipitationMm > .5);
    const dryAverage = average(dry.map(day => day.rideCount)), rainyAverage = average(rainy.map(day => day.rideCount));
    const bands = [
      {label: "<10°", accepts: value => value < 10},
      {label: "10–15°", accepts: value => value >= 10 && value < 15},
      {label: "15–20°", accepts: value => value >= 15 && value < 20},
      {label: "20°+", accepts: value => value >= 20}
    ].map(band => {
      const matches = filtered.filter(day => day.meanTempC !== null && band.accepts(day.meanTempC));
      return {label: band.label, count: matches.length, average: average(matches.map(day => day.rideCount))};
    });
    return {days: filtered, dry: {count: dry.length, average: dryAverage}, rainy: {count: rainy.length, average: rainyAverage},
      difference: dryAverage !== null && dryAverage !== 0 && rainyAverage !== null ? (rainyAverage - dryAverage) / dryAverage * 100 : null, bands};
  }

  function tooltip(day) {
    const date = new Date(`${day.date}T00:00:00Z`).toLocaleDateString(undefined, {day: "numeric", month: "long", timeZone: "UTC"});
    const lines = [date, `${day.rideCount.toLocaleString()} rides`];
    if (day.meanTempC !== null) lines.push(`${day.meanTempC.toLocaleString(undefined, {maximumFractionDigits: 1})} °C avg`);
    if (day.minTempC !== null && day.maxTempC !== null) lines.push(`${day.minTempC.toLocaleString(undefined, {maximumFractionDigits: 1})}–${day.maxTempC.toLocaleString(undefined, {maximumFractionDigits: 1})} °C`);
    if (day.precipitationMm !== null) lines.push(`${day.precipitationMm.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})} mm precipitation`);
    return lines.join("\n");
  }

  function element(name, attributes = {}) {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  function renderScatter(container, days, metric) {
    const key = metric === "rain" ? "precipitationMm" : "meanTempC";
    const points = days.filter(day => day[key] !== null);
    if (!points.length) { container.replaceChildren(); container.textContent = "No daily weather observations available."; return; }
    const width = 600, height = 270, left = 48, right = 14, top = 16, bottom = 40;
    let minX = Math.min(...points.map(day => day[key])), maxX = Math.max(...points.map(day => day[key]));
    const maxY = Math.max(1, ...points.map(day => day.rideCount));
    if (minX === maxX) { minX -= .5; maxX += .5; }
    const x = value => left + (value - minX) / (maxX - minX) * (width - left - right);
    const y = value => top + (1 - value / maxY) * (height - top - bottom);
    const svg = element("svg", {viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `Daily rides by ${metric === "rain" ? "precipitation" : "mean temperature"}`});
    svg.classList.add("weather-scatter-svg");
    svg.append(element("line", {x1: left, x2: left, y1: top, y2: height - bottom, class: "weather-axis"}), element("line", {x1: left, x2: width - right, y1: height - bottom, y2: height - bottom, class: "weather-axis"}));
    const xLabel = element("text", {x: (left + width - right) / 2, y: height - 8, class: "weather-axis-label"}); xLabel.textContent = metric === "rain" ? "Precipitation (mm)" : "Mean temperature (°C)";
    const yLabel = element("text", {x: 12, y: (top + height - bottom) / 2, class: "weather-axis-label", transform: `rotate(-90 12 ${(top + height - bottom) / 2})`}); yLabel.textContent = "Rides";
    svg.append(xLabel, yLabel);
    points.forEach(day => {
      const circle = element("circle", {cx: x(day[key]), cy: y(day.rideCount), r: 6, class: `weather-point ${metric}`, tabindex: "0", role: "button", "aria-label": tooltip(day)});
      const title = element("title"); title.textContent = tooltip(day); circle.append(title);
      const show = () => { container.querySelector(".weather-point.selected")?.classList.remove("selected"); circle.classList.add("selected"); container.parentElement.querySelector("#weather-point-details").textContent = tooltip(day); };
      circle.addEventListener("click", show); circle.addEventListener("focus", show);
      circle.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); show(); } });
      svg.append(circle);
    });
    container.replaceChildren(svg);
  }

  function trapFocus(panel, event, activeElement = document.activeElement) {
    if (event.key !== "Tab") return false;
    const focusable = [...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      .filter(element => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) { event.preventDefault(); panel.focus(); return true; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && activeElement === first) { event.preventDefault(); last.focus(); return true; }
    if (!event.shiftKey && activeElement === last) { event.preventDefault(); first.focus(); return true; }
    if (!panel.contains(activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return true; }
    return false;
  }

  const api = {observations, summarize, periodLabel, availablePeriodTarget, tooltip, renderScatter, trapFocus};
  root.WeatherAnalysis = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
