(function (root) {
  function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function shiftedDate(date, unit, amount) {
    const result = new Date(date);
    if (unit === "month") {
      const day = result.getDate();
      result.setDate(1);
      result.setMonth(result.getMonth() + amount);
      result.setDate(Math.min(day, daysInMonth(result.getFullYear(), result.getMonth())));
    } else if (unit === "day") {
      result.setDate(result.getDate() + amount);
    } else {
      result.setHours(result.getHours() + amount);
    }
    return result;
  }

  root.TimeNavigation = {monthKey, shiftedDate};
}(typeof window === "undefined" ? globalThis : window));
