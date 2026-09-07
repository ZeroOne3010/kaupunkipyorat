const assert = require("node:assert/strict");
require("./flow-style.js");

const {rideCountScale} = globalThis.FlowStyle;

assert.equal(rideCountScale(0), 0);
assert.equal(rideCountScale(1), 0.1);
assert.ok(rideCountScale(2) < 0.15);
assert.equal(rideCountScale(25), 0.5);
assert.equal(rideCountScale(100), 1);
assert.equal(rideCountScale(10_000), 1);

console.log("flow style tests passed");
