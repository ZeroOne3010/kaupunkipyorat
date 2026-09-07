const stationById = new Map(STATIONS.map(([id, name, lat, lon]) => [id, {id, name, lat, lon}]));
let data;
let selectedId = null;
let dataRequestId = 0;

const map = new maplibregl.Map({
  container: "map",
  center: [24.944, 60.162],
  zoom: 13.3,
  attributionControl: false,
  style: "https://tiles.openfreemap.org/styles/bright"
});
map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.AttributionControl({compact: true}), "top-right");

function stationGeoJSON() {
  return {type: "FeatureCollection", features: STATIONS.map(([id, name, lat, lon]) => ({
    type: "Feature", properties: {id, name, selected: id === selectedId}, geometry: {type: "Point", coordinates: [lon, lat]}
  }))};
}

function currentTuples() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  if (mode === "day") return data.d[Number(document.querySelector("#day").value)] || [];
  if (mode === "hour") {
    const index = Number(document.querySelector("#day").value) * 24 + Number(document.querySelector("#hour").value);
    return data.h[index] || [];
  }
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

function renderRanking(selector, connections) {
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
    item.append(document.createTextNode(stationById.get(id).name));
    const value = document.createElement("span");
    value.textContent = count.toLocaleString();
    item.append(value);
    return item;
  }));
}

function update() {
  if (!data || !map.getSource("flows")) return;
  const direction = document.querySelector('input[name="direction"]:checked').value;
  const tuples = currentTuples();
  let shown = tuples.filter(([origin, destination, count]) => {
    if (count < minimumRideCount()) return false;
    if (selectedId === null) return true;
    return (direction !== "incoming" && origin === selectedId) || (direction !== "outgoing" && destination === selectedId);
  });
  shown = shown.filter(([origin, destination]) => stationById.has(origin) && stationById.has(destination));
  const max = Math.max(1, ...shown.map(tuple => tuple[2]));
  map.getSource("flows").setData({type: "FeatureCollection", features: shown.map(([origin, destination, count]) => ({
    type: "Feature", properties: {count, scale: count / max}, geometry: {type: "LineString", coordinates: [
      [stationById.get(origin).lon, stationById.get(origin).lat], [stationById.get(destination).lon, stationById.get(destination).lat]
    ]}
  }))});
  map.getSource("stations").setData(stationGeoJSON());
  const rideCount = shown.reduce((sum, tuple) => sum + tuple[2], 0);
  document.querySelector("#all-rides").textContent = `${rideCount.toLocaleString()} rides shown`;
  const summary = document.querySelector("#station-summary");
  summary.hidden = selectedId === null;
  if (selectedId !== null) {
    document.querySelector("#station").textContent = stationById.get(selectedId).name;
    const stationRideCount = tuples.reduce((sum, [origin, destination, count]) => sum + (origin === selectedId || destination === selectedId ? count : 0), 0);
    document.querySelector("#rides").textContent = `${stationRideCount.toLocaleString()} trips in selected period`;
    renderRanking("#top-outgoing", rankedConnections(tuples, true));
    renderRanking("#top-incoming", rankedConnections(tuples, false));
  }
}

function updateTimeControls() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  document.querySelector("#day-control").hidden = mode === "month";
  document.querySelector("#hour-control").hidden = mode !== "hour";
  updateHourLabel();
  update();
}

function updateHourLabel() {
  if (!data) return;
  const hour = Number(document.querySelector("#hour").value);
  document.querySelector("#hour-label").textContent = `${String(hour).padStart(2, "0")}:00–${String((hour + 1) % 24).padStart(2, "0")}:00`;
  updateStepButtons();
}

function updateStepButtons() {
  if (!data) return;
  const day = Number(document.querySelector("#day").value);
  document.querySelector("#previous-day").disabled = day <= 0;
  document.querySelector("#next-day").disabled = day >= data.d.length - 1;
}

function changeDay(offset) {
  const day = document.querySelector("#day");
  day.value = Math.max(0, Math.min(data.d.length - 1, Number(day.value) + offset));
  updateHourLabel();
  update();
}

function changeHour(offset) {
  const day = document.querySelector("#day");
  const hour = document.querySelector("#hour");
  const lastIndex = data.d.length * 24 - 1;
  const nextIndex = Math.max(0, Math.min(lastIndex, Number(day.value) * 24 + Number(hour.value) + offset));
  day.value = Math.floor(nextIndex / 24);
  hour.value = nextIndex % 24;
  updateHourLabel();
  update();
}

async function loadData(dataFile) {
  const requestId = ++dataRequestId;
  let loadedData;
  try {
    const response = await fetch(`data/${dataFile}`);
    if (requestId !== dataRequestId) return;
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    loadedData = await response.json();
    if (requestId !== dataRequestId) return;
  } catch (error) {
    if (requestId !== dataRequestId) return;
    throw error;
  }
  data = loadedData;
  selectedId = null;
  const day = document.querySelector("#day");
  day.replaceChildren(...data.d.map((_, index) => new Option(`${index + 1}.${data.m}.${data.y}`, index)));
  const hour = document.querySelector("#hour");
  hour.value = 0;
  updateHourLabel();
  update();
}

map.on("load", async () => {
  map.addSource("flows", {type: "geojson", data: {type: "FeatureCollection", features: []}});
  map.addLayer({id: "flows", type: "line", source: "flows", paint: {
    "line-color": "#006bb6", "line-opacity": ["+", 0.2, ["*", 0.65, ["get", "scale"]]], "line-width": ["+", 1, ["*", 7, ["get", "scale"]]]
  }});
  map.addSource("stations", {type: "geojson", data: stationGeoJSON()});
  map.addLayer({id: "stations", type: "circle", source: "stations", paint: {
    "circle-radius": ["case", ["get", "selected"], 9, 6], "circle-color": ["case", ["get", "selected"], "#ed6a00", "#fff"],
    "circle-stroke-color": "#17324d", "circle-stroke-width": 2
  }});
  map.on("click", "stations", event => { selectedId = Number(event.features[0].properties.id); update(); });
  map.on("mouseenter", "stations", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "stations", () => { map.getCanvas().style.cursor = ""; });
  try {
    const response = await fetch("data/months.json");
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const months = await response.json();
    if (!months.length) throw new Error("no monthly data is available");
    const dataset = document.querySelector("#dataset");
    dataset.replaceChildren(...months.map(month => new Option(
      `${month.year}-${String(month.month).padStart(2, "0")}`,
      month.file
    )));
    dataset.value = months.at(-1).file;
    await loadData(dataset.value);
  } catch (error) {
    document.querySelector("#dataset").replaceChildren(new Option(`Could not load data: ${error.message}`));
  }
});

document.querySelectorAll('input[name="mode"]').forEach(input => input.addEventListener("change", updateTimeControls));
document.querySelectorAll('input[name="direction"]').forEach(input => input.addEventListener("change", update));
document.querySelector("#day").addEventListener("change", () => { updateHourLabel(); update(); });
document.querySelector("#hour").addEventListener("change", event => {
  const currentHour = Number(event.target.value);
  event.target.value = Number.isFinite(currentHour) ? currentHour : 0;
  changeHour(0);
});
document.querySelector("#previous-day").addEventListener("click", () => changeDay(-1));
document.querySelector("#next-day").addEventListener("click", () => changeDay(1));
document.querySelector("#previous-hour").addEventListener("click", () => changeHour(-1));
document.querySelector("#next-hour").addEventListener("click", () => changeHour(1));
document.querySelector("#threshold").addEventListener("change", event => {
  event.target.value = minimumRideCount();
  update();
});
document.querySelector("#clear").addEventListener("click", () => { selectedId = null; update(); });
document.querySelector("#toggle-controls").addEventListener("click", event => {
  const panel = event.currentTarget.closest(".panel");
  const collapsed = panel.classList.toggle("collapsed");
  event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
  event.currentTarget.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} map controls`);
});
document.querySelector("#dataset").addEventListener("change", async event => {
  try {
    await loadData(event.target.value);
  } catch (error) {
    window.alert(`Could not load data/${event.target.value}: ${error.message}`);
  }
});
