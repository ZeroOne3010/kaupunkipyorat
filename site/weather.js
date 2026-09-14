(function (root) {
  const ESPOO_LONGITUDE_LIMIT = 24.8474184;

  function cityForLongitude(longitude) {
    return longitude < ESPOO_LONGITUDE_LIMIT ? "espoo" : "helsinki";
  }

  function weatherForSelection(payload, longitude, date, mode) {
    if (!payload || payload.v !== 1 || payload.year !== date.getUTCFullYear()) return null;
    const city = payload.cities?.[cityForLongitude(longitude)];
    if (!city) return null;
    if (mode === "month") return city.months?.[String(date.getUTCMonth() + 1).padStart(2, "0")] ?? null;
    const dateKey = date.toISOString().slice(0, 10);
    const day = city.days?.[dateKey];
    if (!day) return null;
    if (mode === "day") return day.d ?? null;
    return day.h?.[date.getUTCHours()] ?? null;
  }

  function hourlyWeatherForDay(payload, longitude, date) {
    if (!payload || payload.v !== 1 || payload.year !== date.getUTCFullYear()) return null;
    const city = payload.cities?.[cityForLongitude(longitude)];
    const hours = city?.days?.[date.toISOString().slice(0, 10)]?.h;
    if (!Array.isArray(hours)) return null;
    return Array.from({length: 24}, (_, hour) => {
      const tuple = hours[hour];
      if (!Array.isArray(tuple) || tuple.length === 0) return {temperature: null, precipitation: null};
      return {
        temperature: typeof tuple[0] === "number" && Number.isFinite(tuple[0]) ? tuple[0] : null,
        precipitation: typeof tuple[1] === "number" && Number.isFinite(tuple[1]) ? tuple[1] : null
      };
    });
  }

  function dailyWeatherForMonth(payload, longitude, date) {
    if (!payload || payload.v !== 1 || payload.year !== date.getUTCFullYear()) return null;
    const city = payload.cities?.[cityForLongitude(longitude)];
    if (!city?.days) return null;
    const year = date.getUTCFullYear(), month = date.getUTCMonth();
    const dayCount = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Array.from({length: dayCount}, (_, index) => {
      const dateKey = new Date(Date.UTC(year, month, index + 1)).toISOString().slice(0, 10);
      const tuple = city.days[dateKey]?.d;
      const measurement = position => typeof tuple?.[position] === "number" && Number.isFinite(tuple[position]) ? tuple[position] : null;
      return {
        date: dateKey,
        temperature: measurement(0),
        minimumTemperature: measurement(1),
        maximumTemperature: measurement(2),
        precipitation: measurement(3)
      };
    });
  }

  function number(value, options) {
    return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(undefined, options) : null;
  }

  function displayParts(tuple, mode) {
    if (!Array.isArray(tuple) || tuple.length === 0) return null;
    if (mode === "hour") {
      const temperature = number(tuple[0], {minimumFractionDigits: 1, maximumFractionDigits: 1});
      const precipitation = number(tuple[1], {minimumFractionDigits: 1, maximumFractionDigits: 1});
      const speed = number(tuple[2], {minimumFractionDigits: 1, maximumFractionDigits: 1});
      return {
        temperature: temperature === null ? null : `${temperature} °C`,
        precipitation: precipitation === null ? null : `${precipitation} mm precipitation`,
        speed: speed === null ? null : `${speed} m/s`,
        direction: number(tuple[3], {maximumFractionDigits: 0})
      };
    }
    const mean = number(tuple[0], {maximumFractionDigits: 1});
    const minimum = number(tuple[1], {maximumFractionDigits: 1});
    const maximum = number(tuple[2], {maximumFractionDigits: 1});
    const precipitation = number(tuple[3], {minimumFractionDigits: 1, maximumFractionDigits: 1});
    const speed = number(tuple[4], {minimumFractionDigits: 1, maximumFractionDigits: 1});
    return {
      temperature: mean === null ? null : `${mean} °C avg${minimum !== null && maximum !== null ? ` (${minimum}–${maximum})` : ""}`,
      precipitation: precipitation === null ? null : `${precipitation} mm precipitation`,
      speed: speed === null ? null : `${speed} m/s avg`,
      direction: number(tuple[5], {maximumFractionDigits: 0})
    };
  }

  function render(element, tuple, mode) {
    const parts = displayParts(tuple, mode);
    element.replaceChildren();
    if (!parts) {
      element.textContent = "Weather unavailable";
      return;
    }
    const segments = [];
    if (parts.temperature) segments.push(document.createTextNode(parts.temperature));
    if (parts.precipitation) segments.push(document.createTextNode(parts.precipitation));
    if (parts.speed) {
      const wind = document.createElement("span");
      if (parts.direction !== null) {
        const arrow = document.createElement("span");
        arrow.className = "wind-arrow";
        arrow.textContent = "↑";
        arrow.style.transform = `rotate(${parts.direction}deg)`;
        arrow.title = `${parts.direction}°`;
        arrow.setAttribute("aria-label", `Wind direction ${parts.direction} degrees`);
        wind.append(arrow, document.createTextNode(" "));
      }
      wind.append(document.createTextNode(parts.speed));
      segments.push(wind);
    }
    if (!segments.length) element.textContent = "Weather unavailable";
    else segments.forEach((segment, index) => {
      if (index) element.append(document.createTextNode(" · "));
      element.append(segment);
    });
  }

  const api = {ESPOO_LONGITUDE_LIMIT, cityForLongitude, weatherForSelection, hourlyWeatherForDay, dailyWeatherForMonth, displayParts, render};
  root.Weather = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
