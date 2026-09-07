const assert = require("node:assert/strict");
require("./time-navigation.js");

const {availableMonthTarget, monthKey, shiftedDate} = globalThis.TimeNavigation;
const selected = new Date(Date.UTC(2025, 5, 5, 4));

assert.equal(shiftedDate(selected, "hour", -1).toISOString(), "2025-06-05T03:00:00.000Z");
assert.equal(shiftedDate(new Date(Date.UTC(2025, 5, 5, 0)), "hour", -1).toISOString(), "2025-06-04T23:00:00.000Z");
assert.equal(shiftedDate(new Date(Date.UTC(2025, 5, 30, 4)), "day", 1).toISOString(), "2025-07-01T04:00:00.000Z");
assert.equal(shiftedDate(new Date(Date.UTC(2025, 0, 31, 4)), "month", 1).toISOString(), "2025-02-28T04:00:00.000Z");
assert.equal(shiftedDate(new Date(Date.UTC(2024, 0, 31, 4)), "month", 1).toISOString(), "2024-02-29T04:00:00.000Z");
assert.equal(shiftedDate(new Date(Date.UTC(2025, 9, 5, 1)), "hour", 1).toISOString(), "2025-10-05T02:00:00.000Z");
assert.equal(monthKey(shiftedDate(selected, "month", -1)), "2025-05");
assert.equal(selected.toISOString(), "2025-06-05T04:00:00.000Z");
assert.equal(
  availableMonthTarget(new Date(Date.UTC(2026, 3, 30, 4)), -1, ["2025-04", "2025-10", "2026-04"]).toISOString(),
  "2025-10-30T04:00:00.000Z"
);
assert.equal(
  availableMonthTarget(new Date(Date.UTC(2025, 9, 31, 4)), 1, ["2025-10", "2026-02"]).toISOString(),
  "2026-02-28T04:00:00.000Z"
);
assert.equal(availableMonthTarget(selected, 1, ["2025-05", "2025-06"]), null);

console.log("time navigation tests passed");
