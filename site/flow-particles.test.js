const assert = require("node:assert/strict");
const test = require("node:test");
const FlowParticles = require("./flow-particles");

test("prepares cumulative geographic path lengths and interpolates segments", () => {
  const path = FlowParticles.preparePath([[24, 60], [24.01, 60], [24.01, 60.01]]);
  assert.ok(path.totalLength > 1600 && path.totalLength < 1800);
  assert.equal(path.cumulative[0], 0);
  assert.ok(path.cumulative[1] < path.totalLength);
  const point = FlowParticles.positionAt(path, path.cumulative[1] / 2, [0, 0]);
  assert.ok(Math.abs(point[0] - 24.005) < 0.00001);
  assert.equal(point[1], 60);
});

test("allocation is capped, favors volume, and gives visible flows a baseline", () => {
  const flows = [{count: 10000}, {count: 100}, {count: 10}];
  const counts = FlowParticles.allocateCounts(flows, 20);
  assert.equal(counts.reduce((sum, count) => sum + count, 0), 20);
  assert.ok(counts[0] > counts[1]);
  assert.ok(counts.every(count => count >= 1));
});

test("allocation does not fill the cap for very quiet periods", () => {
  assert.deepEqual(FlowParticles.allocateCounts([{count: 1}, {count: 4}], 150), [1, 2]);
});

test("random allocation gives every corridor a chance and caps the largest weight at ten times the smallest", () => {
  const randomValues = [0, 1 / 16, 2 / 16, 6 / 16, 15 / 16];
  const counts = FlowParticles.allocateRandomCounts(
    [{count: 1}, {count: 25}, {count: 10000}],
    randomValues.length,
    () => randomValues.shift()
  );
  assert.deepEqual(counts, [1, 2, 2]);
});

test("particle positions are staggered and remain on their shared prepared path", () => {
  const particles = FlowParticles.createParticles(
    [{count: 20, coordinates: [[0, 0], [0.01, 0]]}], 4, () => 0.5
  );
  assert.equal(particles.length, 4);
  assert.equal(new Set(particles.map(particle => particle.path)).size, 1);
  assert.deepEqual(particles.map(particle => particle.distance / particle.path.totalLength), [0.125, 0.375, 0.625, 0.875]);
  assert.deepEqual(particles.map(particle => particle.direction), [1, 1, 1, 1]);
});

test("bidirectional particle signs are random", () => {
  const randomValues = [0.25, 0.1, 0.75, 0.9, 0.25, 0.6, 0.75, 0.4, 0.25, 0.8, 0.75, 0.2];
  const particles = FlowParticles.createParticles([{
    count: 20, coordinates: [[0, 0], [0.01, 0]], bidirectional: true
  }], 4, () => randomValues.shift());
  assert.deepEqual(particles.map(particle => particle.direction), [1, -1, 1, -1]);
});

test("corridor particles draw a new weighted corridor and direction at each endpoint", () => {
  const particles = FlowParticles.createParticles([
    {count: 1, coordinates: [[0, 0], [0.001, 0]], bidirectional: true},
    {count: 9, coordinates: [[1, 0], [1.002, 0]], bidirectional: true}
  ], 1, () => 0);
  const particle = particles[0];
  const firstPath = particle.path;
  particle.distance = firstPath.totalLength - 10;
  particle.direction = 1;

  const randomValues = [0.99, 0.75];
  FlowParticles.advanceParticle(particle, 25, () => randomValues.shift());

  assert.notEqual(particle.path, firstPath);
  assert.equal(particle.direction, 1);
  assert.equal(particle.distance, 15);
});

test("ordinary route particles continue looping on their original path", () => {
  const particle = FlowParticles.createParticles([
    {count: 1, coordinates: [[0, 0], [0.001, 0]]}
  ], 1, () => 0)[0];
  const originalPath = particle.path;
  particle.distance = originalPath.totalLength - 5;

  FlowParticles.advanceParticle(particle, 10, () => { throw new Error("should not redraw"); });

  assert.equal(particle.path, originalPath);
  assert.ok(Math.abs(particle.distance - 5) < 0.000001);
});
