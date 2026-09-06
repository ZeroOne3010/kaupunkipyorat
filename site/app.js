const MIN_RIDE_COUNT = 1;
const stationById = new Map(STATIONS.map(([id, name, lat, lon]) => [id, {id, name, lat, lon}]));
let data;
let selectedId = null;
let dataRequestId = 0;

const map = new maplibregl.Map({
  container: "map",
  center: [24.944, 60.162],
  zoom: 13.3,
  style: "https://tiles.openfreemap.org/styles/bright"
});
map.addControl(new maplibregl.NavigationControl(), "bottom-right");

function stationGeoJSON() {
  return {type: "FeatureCollection", features: STATIONS.map(([id, name, lat, lon]) => ({
    type: "Feature", properties: {id, name, selected: id === selectedId}, geometry: {type: "Point", coordinates: [lon, lat]}
  }))};
}

function currentTuples() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  if (mode === "day") return data.d[Number(document.querySelector("#day").value)] || [];
  if (mode === "hour") return data.h[Number(document.querySelector("#hour").value)] || [];
  return data.total;
}

function update() {
  if (!data || !map.getSource("flows")) return;
  const direction = document.querySelector('input[name="direction"]:checked').value;
  const tuples = currentTuples();
  let shown = tuples.filter(([origin, destination, count]) => {
    if (count < MIN_RIDE_COUNT) return false;
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
  document.querySelector("#station").textContent = selectedId === null ? "All stations" : stationById.get(selectedId).name;
  document.querySelector("#rides").textContent = `${rideCount.toLocaleString()} rides shown`;
  document.querySelector("#clear").hidden = selectedId === null;
}

function updateTimeControls() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  document.querySelector("#day-control").hidden = mode !== "day";
  document.querySelector("#hour-control").hidden = mode !== "hour";
  updateHourLabel();
  update();
}

function updateHourLabel() {
  if (!data) return;
  const index = Number(document.querySelector("#hour").value);
  const date = new Date(Date.UTC(data.y, data.m - 1, 1, index));
  document.querySelector("#hour-label").textContent = new Intl.DateTimeFormat(undefined, {day: "numeric", month: "short", hour: "2-digit", timeZone: "UTC"}).format(date);
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
  hour.max = data.h.length - 1;
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
document.querySelector("#day").addEventListener("change", update);
document.querySelector("#hour").addEventListener("input", () => { updateHourLabel(); update(); });
document.querySelector("#clear").addEventListener("click", () => { selectedId = null; update(); });
document.querySelector("#dataset").addEventListener("change", async event => {
  try {
    await loadData(event.target.value);
  } catch (error) {
    window.alert(`Could not load data/${event.target.value}: ${error.message}`);
  }
});
