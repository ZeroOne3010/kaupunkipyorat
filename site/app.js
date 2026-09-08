const stationById = new Map(STATIONS.map(([id, name, lat, lon]) => [id, {id, name, lat, lon}]));
let data;
let selectedId = null;
let selectedDate = null;
let dataRequestId = 0;
let availableMonths = new Map();
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
  return {type: "FeatureCollection", features: STATIONS.map(([id, name, lat, lon]) => ({
    type: "Feature", properties: {
      id,
      name,
      selected: id === selectedId,
      balance: StationBalance.balanceCategory(balances.get(id))
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

function update() {
  if (!data || !selectedDate || !map.getSource("flows")) return;
  updateTimeDisplay();
  const direction = document.querySelector('input[name="direction"]:checked').value;
  const tuples = currentTuples();
  let shown = tuples.filter(([origin, destination, count]) => {
    if (count < minimumRideCount()) return false;
    if (selectedId === null) return true;
    return (direction !== "incoming" && origin === selectedId) || (direction !== "outgoing" && destination === selectedId);
  });
  shown = shown.filter(([origin, destination]) => stationById.has(origin) && stationById.has(destination));
  map.getSource("flows").setData({type: "FeatureCollection", features: shown.map(([origin, destination, count]) => ({
    type: "Feature", properties: {count, scale: FlowStyle.rideCountScale(count)}, geometry: {type: "LineString", coordinates: [
      [stationById.get(origin).lon, stationById.get(origin).lat], [stationById.get(destination).lon, stationById.get(destination).lat]
    ]}
  }))});
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
  map.addSource("stations", {type: "geojson", data: stationGeoJSON()});
  map.addLayer({id: "stations", type: "circle", source: "stations", paint: {
    "circle-radius": ["case", ["get", "selected"], 9, 6],
    "circle-color": ["match", ["get", "balance"],
      "positive-strong", "#087f5b", "positive", "#63b58f", "negative", "#e88e8e", "negative-strong", "#c7384f", "#f5f3ed"
    ],
    "circle-stroke-color": ["case", ["get", "selected"], "#ed6a00", "#17324d"],
    "circle-stroke-width": ["case", ["get", "selected"], 4, 2]
  }});
  map.on("click", "stations", event => { selectedId = Number(event.features[0].properties.id); update(); });
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
  } catch (error) {
    document.querySelector("#period-label").textContent = `Could not load data: ${error.message}`;
    document.querySelector("#collapsed-status").textContent = "Data unavailable";
  }
});

document.querySelectorAll('input[name="mode"]').forEach(input => input.addEventListener("change", update));
document.querySelectorAll('input[name="direction"]').forEach(input => input.addEventListener("change", update));
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
