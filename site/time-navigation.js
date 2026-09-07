(function (root) {
  function monthKey(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function daysInMonth(year, monthIndex) {
    return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  }

  function shiftedDate(date, unit, amount) {
    const result = new Date(date);
    if (unit === "month") {
      const day = result.getUTCDate();
      result.setUTCDate(1);
      result.setUTCMonth(result.getUTCMonth() + amount);
      result.setUTCDate(Math.min(day, daysInMonth(result.getUTCFullYear(), result.getUTCMonth())));
    } else if (unit === "day") {
      result.setUTCDate(result.getUTCDate() + amount);
    } else {
      result.setUTCHours(result.getUTCHours() + amount);
    }
    return result;
  }

  function availableMonthTarget(date, amount, availableKeys) {
    const shifted = shiftedDate(date, "month", amount);
    if (availableKeys.includes(monthKey(shifted))) return shifted;
    const currentKey = monthKey(date);
    const keys = [...availableKeys].sort();
    const targetKey = amount < 0
      ? keys.filter(key => key < currentKey).at(-1)
      : keys.find(key => key > currentKey);
    if (!targetKey) return null;
    const [year, month] = targetKey.split("-").map(Number);
    const monthOffset = (year - date.getUTCFullYear()) * 12 + month - date.getUTCMonth() - 1;
    return shiftedDate(date, "month", monthOffset);
  }

  root.TimeNavigation = {availableMonthTarget, monthKey, shiftedDate};
}(typeof window === "undefined" ? globalThis : window));
