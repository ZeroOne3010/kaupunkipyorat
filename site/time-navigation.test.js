const assert = require("node:assert/strict");
require("./time-navigation.js");

const {monthKey, shiftedDate} = globalThis.TimeNavigation;
const selected = new Date(2025, 5, 5, 4);

assert.equal(shiftedDate(selected, "hour", -1).toString(), new Date(2025, 5, 5, 3).toString());
assert.equal(shiftedDate(new Date(2025, 5, 5, 0), "hour", -1).toString(), new Date(2025, 5, 4, 23).toString());
assert.equal(shiftedDate(new Date(2025, 5, 30, 4), "day", 1).toString(), new Date(2025, 6, 1, 4).toString());
assert.equal(shiftedDate(new Date(2025, 0, 31, 4), "month", 1).toString(), new Date(2025, 1, 28, 4).toString());
assert.equal(shiftedDate(new Date(2024, 0, 31, 4), "month", 1).toString(), new Date(2024, 1, 29, 4).toString());
assert.equal(monthKey(shiftedDate(selected, "month", -1)), "2025-05");
assert.equal(selected.toString(), new Date(2025, 5, 5, 4).toString());

console.log("time navigation tests passed");
