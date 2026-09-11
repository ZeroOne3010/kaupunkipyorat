const stationById = new Map(STATIONS.map(([id, name, lat, lon]) => [id, {id, name, lat, lon}]));
let data;
let selectedId = null;
let selectedDate = null;
let dataRequestId = 0;
let availableMonths = new Map();
let insightRide = null;
let insightPreviousView = null;
const insightCache = new Map();
const expandedInsights = new Set();
const routeCache = new Map();
const routeRequests = new Map();
const unavailableRoutes = new Set();
const decodedRouteCache = new Map();
const {availableMonthTarget, monthKey, shiftedDate} = TimeNavigation;

const map = new maplibregl.Map({
  container: "map",
  center: [24.944, 60.162],
  zoom: 13.3,
  attributionControl: false,
  style: "https://tiles.openfreemap.org/styles/bright"
});
map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.AttributionControl({compact: true}), "top-right");

function stationGeoJSON(tuples = []) {
  const balances = StationBalance.stationBalances(STATIONS, tuples);
  const coloring = document.querySelector('input[name="coloring"]:checked').value;
  const maxBusyness = Math.max(0, ...[...balances.values()].map(StationBalance.stationBusyness));
  const metric = coloring === "busyness" ? StationStyle.busynessMetric(maxBusyness) : StationStyle.flowBalanceMetric;
  return {type: "FeatureCollection", features: STATIONS.map(([id, name, lat, lon]) => ({
    type: "Feature", properties: {
      id,
      name,
      selected: id === selectedId,
      insight: insightRide && (id === insightRide.origin || id === insightRide.destination),
      coloring,
      ...StationStyle.stationProperties(metric, balances.get(id))
    }, geometry: {type: "Point", coordinates: [lon, lat]}
  }))};
}

function currentTuples() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const dayIndex = selectedDate.getUTCDate() - 1;
  if (mode === "day") return data.d[dayIndex] || [];
  if (mode === "hour") return data.h[dayIndex * 24 + selectedDate.getUTCHours()] || [];
  return data.total;
}

function minimumRideCount() {
  return Math.max(1, Number(document.querySelector("#threshold").value) || 1);
}

function rankedConnections(tuples, outgoing) {
  const totals = new Map();
  tuples.forEach(([origin, destination, count]) => {
    if ((outgoing ? origin : destination) !== selectedId) return;
    const otherId = outgoing ? destination : origin;
    if (stationById.has(otherId)) totals.set(otherId, (totals.get(otherId) || 0) + count);
  });
  return [...totals].sort((a, b) => b[1] - a[1]).slice(0, 5);
}

function renderRanking(selector, connections, total) {
  const list = document.querySelector(selector);
  if (!connections.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No trips";
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...connections.map(([id, count]) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.stationId = id;
    button.append(document.createTextNode(stationById.get(id).name));
    const value = document.createElement("span");
    const share = total ? count / total * 100 : 0;
    value.textContent = `${count.toLocaleString()}${connections[0][0] === id ? ` · ${share.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}%` : ""}`;
    button.append(value);
    button.setAttribute("aria-label", `Select ${stationById.get(id).name}, ${count.toLocaleString()} trips${connections[0][0] === id ? `, ${share.toFixed(1)} percent share` : ""}`);
    item.append(button);
    return item;
  }));
}

function periodText(short = false) {
  if (!selectedDate) return "Loading data…";
  const mode = document.querySelector('input[name="mode"]:checked').value;
  if (mode === "month") return selectedDate.toLocaleDateString(undefined, {month: "long", year: "numeric", timeZone: "UTC"});
  const date = selectedDate.toLocaleDateString(undefined, short
    ? {weekday: "short", day: "numeric", month: "short", timeZone: "UTC"}
    : {weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC"});
  if (mode === "day") return date;
  const start = `${String(selectedDate.getUTCHours()).padStart(2, "0")}:00`;
  const end = `${String((selectedDate.getUTCHours() + 1) % 24).padStart(2, "0")}:00`;
  return `${date}${short ? " · " : " · "}${start}${short ? "" : `–${end}`}`;
}

function updateTimeDisplay() {
  document.querySelector("#period-label").textContent = periodText();
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const abbreviation = {month: "M", day: "d", hour: "h"}[mode];
  document.querySelectorAll("#collapsed-navigation button").forEach(button => {
    const amount = Number(button.dataset.step);
    button.dataset.unit = mode;
    button.textContent = `${amount < 0 ? "−" : "+"}1${abbreviation}`;
    button.setAttribute("aria-label", `${amount < 0 ? "Previous" : "Next"} ${mode}`);
  });
  updateNavigationButtons();
}

function updateNavigationButtons() {
  document.querySelectorAll(".time-navigation button").forEach(button => {
    button.disabled = !navigationTarget(button.dataset.unit, Number(button.dataset.step));
  });
}

function navigationTarget(unit, amount) {
  if (!selectedDate) return null;
  const target = shiftedDate(selectedDate, unit, amount);
  if (availableMonths.has(monthKey(target))) return target;
  if (unit !== "month") return null;
  return availableMonthTarget(selectedDate, amount, [...availableMonths.keys()]);
}

function routedGeometryEnabled() {
  return document.querySelector('input[name="geometry"]:checked').value === "routes";
}

async function loadSelectedRoutes() {
  const stationId = selectedId;
  if (!routedGeometryEnabled() || stationId === null || routeCache.has(stationId) || unavailableRoutes.has(stationId)) return;
  if (!routeRequests.has(stationId)) {
    routeRequests.set(stationId, fetch(`routes/${stationId}.json`).then(async response => {
      if (!response.ok) {
        unavailableRoutes.add(stationId);
        return;
      }
      const routes = await response.json();
      if (routes?.v === 1 && routes.station === stationId && routes.out) routeCache.set(stationId, routes);
      else unavailableRoutes.add(stationId);
    }).catch(() => unavailableRoutes.add(stationId)).finally(() => routeRequests.delete(stationId)));
  }
  await routeRequests.get(stationId);
  if (routeCache.has(stationId) && selectedId === stationId && routedGeometryEnabled()) update();
}

function update() {
  if (!data || !selectedDate || !map.getSource("flows")) return;
  updateTimeDisplay();
  const direction = document.querySelector('input[name="direction"]:checked').value;
  const tuples = currentTuples();
  const coloring = document.querySelector('input[name="coloring"]:checked').value;
  document.querySelector("#balance-legend").hidden = coloring !== "flow";
  document.querySelector("#busyness-legend").hidden = coloring !== "busyness";
  if (map.getLayer("station-heat-busyness")) {
    map.setLayoutProperty("station-heat-busyness", "visibility", coloring === "busyness" ? "visible" : "none");
    ["neutral", "negative-low", "positive-low", "negative", "positive", "negative-strong", "positive-strong"].forEach(category => {
      map.setLayoutProperty(`station-heat-${category}`, "visibility", coloring === "flow" ? "visible" : "none");
    });
  }
  let shown = tuples.filter(([origin, destination, count]) => {
    if (count < minimumRideCount()) return false;
    if (selectedId === null) return true;
    return (direction !== "incoming" && origin === selectedId) || (direction !== "outgoing" && destination === selectedId);
  });
  shown = shown.filter(([origin, destination]) => stationById.has(origin) && stationById.has(destination));
  const selectedRoutes = routedGeometryEnabled() && selectedId !== null ? routeCache.get(selectedId) : null;
  map.getSource("flows").setData({type: "FeatureCollection", features: shown.map(([origin, destination, count]) => ({
    type: "Feature", properties: {count, scale: FlowStyle.rideCountScale(count)}, geometry: {type: "LineString", coordinates:
      RouteGeometry.connectionCoordinates(stationById.get(origin), stationById.get(destination), selectedId, selectedRoutes, decodedRouteCache)
    }
  }))});
  loadSelectedRoutes();
  map.getSource("stations").setData(stationGeoJSON(tuples));
  const rideCount = shown.reduce((sum, tuple) => sum + tuple[2], 0);
  const rides = `${rideCount.toLocaleString()} rides`;
  document.querySelector("#all-rides").textContent = `${rides} shown`;
  document.querySelector("#collapsed-status").textContent = `${periodText(true)} · ${rides}`;
  const summary = document.querySelector("#station-summary");
  summary.hidden = selectedId === null;
  if (selectedId !== null) {
    document.querySelector("#station").textContent = stationById.get(selectedId).name;
    const stationStats = StationSummary.stationSummary(selectedId, tuples);
    document.querySelector("#summary-period").textContent = StationSummary.formatPeriod(periodText(), stationStats.trips);
    const busiest = StationSummary.busiestStationRank(selectedId, STATIONS.map(([id]) => id), tuples);
    document.querySelector("#station-rank").textContent = `#${busiest.rank.toLocaleString()} busiest of ${busiest.total.toLocaleString()} stations`;
    document.querySelector("#balance-summary").textContent = `${stationStats.arrivals.toLocaleString()} arrivals · ${stationStats.departures.toLocaleString()} departures · ${StationSummary.formatNetFlow(stationStats.arrivals, stationStats.departures)}`;
    document.querySelector("#average-ride").textContent = stationStats.trips
      ? `${(stationStats.averageDistanceMeters / 1000).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})} km · ${StationSummary.formatDuration(stationStats.averageDurationSeconds)} · ${stationStats.averageSpeedKmh.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})} km/h`
      : "—";
    document.querySelector("#round-trips").textContent = `${stationStats.roundTrips.toLocaleString()} · ${stationStats.roundTripPercentage.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}%`;
    document.querySelector("#unique-destinations").textContent = `${stationStats.uniqueDestinations.toLocaleString()} unique`;
    document.querySelector("#unique-origins").textContent = `${stationStats.uniqueOrigins.toLocaleString()} unique`;
    renderRanking("#top-outgoing", rankedConnections(tuples, true), stationStats.departures);
    renderRanking("#top-incoming", rankedConnections(tuples, false), stationStats.arrivals);
  }
}

async function loadData(dataFile) {
  const requestId = ++dataRequestId;
  const response = await fetch(`data/${dataFile}`);
  if (requestId !== dataRequestId) return false;
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const loadedData = await response.json();
  if (requestId !== dataRequestId) return false;
  data = loadedData;
  return true;
}

async function navigateTime(unit, amount) {
  const previousDate = selectedDate;
  const target = navigationTarget(unit, amount);
  if (!target) return;
  const targetFile = availableMonths.get(monthKey(target));
  if (!targetFile) return;
  const notice = document.querySelector("#data-notice");
  notice.textContent = "";
  document.querySelectorAll(".time-navigation button").forEach(button => { button.disabled = true; });
  try {
    if (monthKey(target) !== monthKey(previousDate) && !await loadData(targetFile)) return;
    selectedDate = target;
    closeInsightVisualization();
    prepareInsights();
    update();
  } catch (error) {
    selectedDate = previousDate;
    notice.textContent = "Data is unavailable for that month.";
    updateNavigationButtons();
  }
}

map.on("load", async () => {
  map.addSource("flows", {type: "geojson", data: {type: "FeatureCollection", features: []}});
  map.addLayer({id: "flows", type: "line", source: "flows", paint: {
    "line-color": "#006bb6", "line-opacity": ["+", 0.2, ["*", 0.65, ["get", "scale"]]], "line-width": ["+", 1, ["*", 7, ["get", "scale"]]]
  }});
  map.addSource("insight-flow", {type: "geojson", data: {type: "FeatureCollection", features: []}});
  map.addLayer({id: "insight-flow", type: "line", source: "insight-flow", paint: {
    "line-color": "#ed6a00", "line-width": 5, "line-opacity": .9, "line-dasharray": [1.5, 1]
  }});
  map.addSource("stations", {type: "geojson", data: stationGeoJSON()});
  const stationCategories = ["neutral", "negative-low", "positive-low", "negative", "positive", "negative-strong", "positive-strong"];
  stationCategories.forEach(category => map.addLayer({
    id: `station-heat-${category}`,
    type: "heatmap",
    source: "stations",
    maxzoom: 12.5,
    filter: ["==", ["get", "colorCategory"], category],
    paint: {
      "heatmap-weight": ["interpolate", ["linear"], ["get", "colorWeight"], 0, 0, 1, 0.3, 500, 1],
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 8, 0.9, 10, 1.5, 12, 2.4],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 8, 18, 10, 28, 12, 40],
      "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.9, 11.5, 0.9, 12.5, 0],
      "heatmap-color": StationStyle.heatmapColor(category)
    }
  }));
  map.addLayer({id: "station-heat-busyness", type: "heatmap", source: "stations", maxzoom: 12.5,
    filter: ["==", ["get", "colorCategory"], "busyness"], layout: {visibility: "none"}, paint: {
      "heatmap-weight": ["get", "normalizedBusyness"],
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 8, 0.9, 10, 1.5, 12, 2.4],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 8, 18, 10, 28, 12, 40],
      "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.9, 11.5, 0.9, 12.5, 0],
      "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
        0, "rgba(217,240,240,0)", 0.15, "rgba(156,207,211,.25)", 0.45, "rgba(91,143,184,.48)", 1, "rgba(91,42,134,.78)"]
    }});
  map.addLayer({id: "stations", type: "circle", source: "stations", minzoom: 11.5, paint: {
    "circle-radius": ["case", ["get", "selected"], 9, 6],
    "circle-color": ["case", ["==", ["get", "coloring"], "busyness"],
      ["interpolate", ["linear"], ["get", "normalizedBusyness"], 0, StationStyle.BUSYNESS_COLORS.low, 1, StationStyle.BUSYNESS_COLORS.high],
      ["match", ["get", "colorCategory"], ...Object.entries(StationStyle.COLORS).flat(), StationStyle.COLORS.neutral]],
    "circle-opacity": ["interpolate", ["linear"], ["zoom"], 11.5, 0, 12, 1],
    "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 11.5, 0, 12, 1],
    "circle-stroke-color": ["case", ["get", "selected"], "#ed6a00", "#17324d"],
    "circle-stroke-width": ["case", ["get", "selected"], 4, 2]
  }});
  map.addLayer({id: "insight-stations", type: "circle", source: "stations", minzoom: 0, filter: ["==", ["get", "insight"], true], paint: {
    "circle-radius": 10, "circle-color": "#fff", "circle-stroke-color": "#ed6a00", "circle-stroke-width": 5
  }});
  map.on("click", "stations", event => { closeInsightVisualization(); selectedId = Number(event.features[0].properties.id); update(); });
  map.on("mouseenter", "stations", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "stations", () => { map.getCanvas().style.cursor = ""; });
  try {
    const response = await fetch("data/months.json");
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const months = await response.json();
    if (!months.length) throw new Error("no monthly data is available");
    availableMonths = new Map(months.map(month => [
      `${month.year}-${String(month.month).padStart(2, "0")}`,
      month.file
    ]));
    const latest = months.at(-1);
    await loadData(latest.file);
    selectedDate = new Date(Date.UTC(latest.year, latest.month - 1, 1, 0));
    update();
    prepareInsights();
  } catch (error) {
    document.querySelector("#period-label").textContent = `Could not load data: ${error.message}`;
    document.querySelector("#collapsed-status").textContent = "Data unavailable";
  }
});

document.querySelectorAll('input[name="mode"]').forEach(input => input.addEventListener("change", update));
document.querySelectorAll('input[name="direction"]').forEach(input => input.addEventListener("change", update));
document.querySelectorAll('input[name="coloring"]').forEach(input => input.addEventListener("change", update));
document.querySelectorAll('input[name="geometry"]').forEach(input => input.addEventListener("change", update));
document.querySelectorAll(".time-navigation button").forEach(button => button.addEventListener("click", () => {
  navigateTime(button.dataset.unit, Number(button.dataset.step));
}));
document.querySelector("#threshold").addEventListener("change", event => {
  event.target.value = minimumRideCount();
  update();
});
document.querySelector("#clear").addEventListener("click", () => { selectedId = null; update(); });
document.querySelectorAll("#top-outgoing, #top-incoming").forEach(list => list.addEventListener("click", event => {
  const button = event.target.closest("button[data-station-id]");
  if (!button) return;
  selectedId = Number(button.dataset.stationId);
  update();
}));
document.querySelector("#toggle-summary").addEventListener("click", event => {
  const summary = event.currentTarget.closest(".summary");
  const collapsed = summary.classList.toggle("collapsed");
  event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
  event.currentTarget.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} station summary`);
});
document.querySelector("#toggle-controls").addEventListener("click", event => {
  const panel = event.currentTarget.closest(".panel");
  const collapsed = panel.classList.toggle("collapsed");
  event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
  event.currentTarget.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} map controls`);
});

function recordsUrl() {
  return `data/records/${monthKey(selectedDate)}.json`;
}

async function prepareInsights() {
  if (!selectedDate) return;
  const key = monthKey(selectedDate);
  const button = document.querySelector("#open-insights");
  button.disabled = true;
  if (!insightCache.has(key)) {
    try {
      const response = await fetch(recordsUrl());
      insightCache.set(key, response.ok ? await response.json() : null);
    } catch (_) {
      insightCache.set(key, null);
    }
  }
  if (selectedDate && monthKey(selectedDate) === key) {
    button.disabled = false;
    button.title = insightCache.get(key) ? "View monthly ride records" : "Insights unavailable for this month";
  }
}

function renderInsights(focusToggleKey) {
  const result = insightCache.get(monthKey(selectedDate));
  const rides = MonthlyInsights.records(result);
  const list = document.querySelector("#insights-list");
  const groups = MonthlyInsights.definitions.map(([key]) => rides.filter(ride => ride.key === key)).filter(group => group.length);
  list.replaceChildren(...groups.map(group => {
    const container = document.createElement("div");
    container.className = "insight-group";
    const visible = expandedInsights.has(group[0].key) ? group : group.slice(0, 1);
    container.append(...visible.map(ride => {
      const origin = stationById.get(Number(ride.origin));
      const destination = stationById.get(Number(ride.destination));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "insight-row";
      button.disabled = !origin || !destination;
      button.dataset.insightId = ride.id;
      const label = document.createElement("span"); label.className = "insight-label"; label.textContent = `${ride.label}${group.length > 1 ? ` #${ride.rank}` : ""}`;
      const route = document.createElement("span"); route.className = "insight-route"; route.textContent = `${origin?.name || ride.origin} → ${destination?.name || ride.destination}`;
      const details = document.createElement("span"); details.className = "insight-details"; details.textContent = MonthlyInsights.details(ride.key, ride);
      button.append(label, route, details);
      return button;
    }));
    if (group.length > 1) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "insight-expand";
      toggle.dataset.expandInsight = group[0].key;
      const expanded = expandedInsights.has(group[0].key);
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.textContent = expanded ? "Show only the record" : `Show all ${group.length}`;
      container.append(toggle);
    }
    return container;
  }));
  if (focusToggleKey) {
    [...list.querySelectorAll("[data-expand-insight]")]
      .find(toggle => toggle.dataset.expandInsight === focusToggleKey)?.focus();
  }
  return rides;
}

function showInsights() {
  if (insightRide) {
    closeInsightVisualization();
    return;
  }
  expandedInsights.clear();
  const rides = renderInsights();
  document.querySelector("#insights-month").textContent = `${selectedDate.toLocaleDateString(undefined, {month: "long", year: "numeric", timeZone: "UTC"})} — Monthly insights`;
  document.querySelector("#insights-unavailable").hidden = rides.length > 0;
  document.querySelector("#insights-panel").hidden = false;
  document.querySelector("#insights-backdrop").hidden = false;
  document.querySelector("#close-insights").focus();
}

function hideInsights() {
  document.querySelector("#insights-panel").hidden = true;
  document.querySelector("#insights-backdrop").hidden = true;
}

function visualizeInsight(ride) {
  const origin = stationById.get(Number(ride.origin));
  const destination = stationById.get(Number(ride.destination));
  if (!origin || !destination) return;
  insightPreviousView = {center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch()};
  insightRide = {...ride, origin: origin.id, destination: destination.id};
  const coordinates = [[origin.lon, origin.lat], [destination.lon, destination.lat]];
  map.getSource("insight-flow").setData({type: "FeatureCollection", features: origin.id === destination.id ? [] : [{type: "Feature", properties: {}, geometry: {type: "LineString", coordinates}}]});
  map.getSource("stations").setData(stationGeoJSON(currentTuples()));
  if (origin.id === destination.id) map.jumpTo({center: coordinates[0], zoom: Math.max(map.getZoom(), 14)});
  else map.fitBounds(coordinates, {padding: 70, maxZoom: 14, duration: 0});
  hideInsights();
  const opener = document.querySelector("#open-insights");
  opener.innerHTML = '<span aria-hidden="true">×</span> Insight';
  opener.setAttribute("aria-label", "Close insight visualization and restore map");
}

function closeInsightVisualization() {
  if (!insightRide) return;
  insightRide = null;
  map.getSource("insight-flow")?.setData({type: "FeatureCollection", features: []});
  if (data) map.getSource("stations")?.setData(stationGeoJSON(currentTuples()));
  if (insightPreviousView) map.jumpTo(insightPreviousView);
  insightPreviousView = null;
  const opener = document.querySelector("#open-insights");
  opener.innerHTML = '<span aria-hidden="true">✦</span> Insights';
  opener.setAttribute("aria-label", "Open monthly insights");
}

document.querySelector("#open-insights").addEventListener("click", showInsights);
document.querySelector("#close-insights").addEventListener("click", hideInsights);
document.querySelector("#insights-backdrop").addEventListener("click", hideInsights);
document.querySelector("#insights-list").addEventListener("click", event => {
  const toggle = event.target.closest("[data-expand-insight]");
  if (toggle) {
    const key = toggle.dataset.expandInsight;
    if (expandedInsights.has(key)) expandedInsights.delete(key); else expandedInsights.add(key);
    renderInsights(key);
    return;
  }
  const button = event.target.closest("[data-insight-id]");
  if (!button) return;
  const ride = MonthlyInsights.records(insightCache.get(monthKey(selectedDate))).find(item => item.id === button.dataset.insightId);
  if (ride) visualizeInsight(ride);
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !document.querySelector("#insights-panel").hidden) hideInsights();
});
