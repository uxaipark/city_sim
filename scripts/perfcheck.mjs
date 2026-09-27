// node scripts/perfcheck.mjs [absolute path to an unmodified src directory]
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { generateCity } from '../src/citygen.js';
import { Signals } from '../src/signals.js';
import { Traffic } from '../src/traffic.js';
import { People } from '../src/people.js';
import { buildTrees } from '../src/vegetation.js';
import { TREE_SPECIES } from '../src/tree-species.js';

const city = generateCity(7);
const U = { uTime: { value: 0 }, uNight: { value: 0 } };
const trees = buildTrees(city, U);
const fullTrees = trees.userData.batches.map(b => b.full);
assert.equal(fullTrees.length, 20);
assert.equal(new Set(city.trees.filter(t => t.park).map(t => t.kind)).size, 20);
assert.equal(fullTrees.reduce((n, m) => n + m.count, 0), city.trees.length);
for (const mesh of fullTrees) {
  assert(Number.isFinite(mesh.boundingSphere.radius));
  for (const v of mesh.geometry.attributes.position.array) assert(Number.isFinite(v));
}
console.log('tree vertices:', fullTrees.reduce((n, m) => n + m.count * m.geometry.attributes.position.count, 0), 'vs unindexed:', fullTrees.reduce((n, m) => n + m.count * m.geometry.userData.unindexedVertices, 0));
console.log('trees:', city.trees.length, 'park:', city.trees.filter(t => t.park).length, 'species:', TREE_SPECIES.length);

function create(C, S, T, P) {
  const signals = new S(C);
  return { signals, traffic: new T(C, U, signals, 18000, 500), people: new P(C, U, signals), times: [] };
}
const current = create(city, Signals, Traffic, People);
let reference;
if (process.argv[2]) {
  const dir = process.argv[2];
  const mod = async name => import(pathToFileURL(`${dir}/${name}.js`));
  const [c, s, t, p] = await Promise.all(['citygen', 'signals', 'traffic', 'people'].map(mod));
  const oldCity = c.generateCity(7);
  assert.deepEqual(city.buildings, oldCity.buildings);
  const lines = c => c.subwayLines.map(l => ({ name: l.name, color: l.color, nodes: l.nodes.map(n => n.id), stations: l.stations.map(n => n.id) }));
  assert.deepEqual(lines(city), lines(oldCity));
  const edges = c => c.edges.map(({ a, b, ...e }) => ({ ...e, a: a.id, b: b.id }));
  assert.deepEqual(edges(city), edges(oldCity));
  console.log('original trees:', oldCity.trees.length, 'roads/buildings/subway unchanged');
  reference = create(oldCity, s.Signals, t.Traffic, p.People);
}
const focus = new THREE.Vector3(500, 0, -1100);
const checks = [59, 179, 359];
function step(sim, frame) {
  sim.traffic.setDensity(frame < 180 ? 0.7 : 0.9, 0.65);
  sim.people.setDensity(frame < 180 ? 0.65 : 0.85);
  sim.people.mesh.visible = frame >= 60;
  const start = performance.now();
  sim.signals.update(frame / 60);
  sim.people.update(1 / 60, focus, frame < 60);
  sim.traffic.update(1 / 60, frame / 60, sim.people.nodeCross);
  if (frame >= 60) sim.times.push(performance.now() - start);
  // Emulate renderer consuming dirty ranges; headless tests have no GPU.
  for (const attr of [sim.signals.vehLamp.instanceColor, sim.signals.pedLamp.instanceColor,
    sim.traffic.carMesh.instanceMatrix, sim.traffic.busMesh.instanceMatrix, sim.people.mesh.instanceMatrix]) attr.clearUpdateRanges();
}
for (let frame = 0; frame < 360; frame++) {
  if (frame === 120) focus.set(-1000, 0, 500);
  if (frame % 2 && reference) step(reference, frame);
  step(current, frame);
  if (!(frame % 2) && reference) step(reference, frame);
  if (reference && checks.includes(frame)) {
    for (const key of ['t', 'v', 'edge', 'dir', 'lane', 'inTurn', 'yaw']) assert.deepEqual(current.traffic[key], reference.traffic[key], `traffic ${key}`);
    for (const key of ['t', 'off', 'edge', 'dir', 'crossing', 'nodeCross']) assert.deepEqual(current.people[key], reference.people[key], `people ${key}`);
    for (const key of ['vehLamp', 'pedLamp']) assert.deepEqual(current.signals[key].instanceColor.array, reference.signals[key].instanceColor.array, key);
    assert.deepEqual(current.people.positions, reference.people.positions || reference.people.mesh.instanceMatrix.array);
    assert.deepEqual(current.traffic.carMesh.instanceMatrix.array, reference.traffic.carMesh.instanceMatrix.array);
  }
}
for (const key of ['t', 'v', 'yaw']) for (const v of current.traffic[key]) assert(Number.isFinite(v));
for (const [name, sim] of [['optimized', current], ['baseline', reference]]) {
  if (!sim) continue;
  sim.times.sort((a, b) => a - b);
  const mean = sim.times.reduce((a, b) => a + b, 0) / sim.times.length;
  console.log(name, JSON.stringify({ meanMs: mean, medianMs: sim.times[150], p95Ms: sim.times[285] }));
}
console.log('PASS: finite geometry/simulation; reference comparisons passed when supplied');

const camera = new THREE.PerspectiveCamera(48, 16 / 9, 1, 120000);
camera.position.set(500, 200, -800); camera.lookAt(500, 0, -1100);
current.people.mesh.visible = true;
current.people.updateRender(camera);
assert(current.people.mesh.count > 0 && current.people.mesh.count < current.people.active);
for (let i = 0; i < current.people.mesh.count; i++) {
  const id = current.people.renderIds[i];
  assert.deepEqual(current.people.mesh.instanceMatrix.array.subarray(i * 16, i * 16 + 16), current.people.positions.subarray(id * 16, id * 16 + 16));
  assert.deepEqual(current.people.mesh.instanceColor.array.subarray(i * 3, i * 3 + 3), current.people.colors.subarray(id * 3, id * 3 + 3));
}
console.log('visible pedestrians:', current.people.mesh.count, '/', current.people.active);

// Exercise both signal axes, arrow phases and pedestrian blinking over two cycles.
if (reference) {
  for (let time = 0; time < 128; time += 1.37) {
    current.signals.update(time); reference.signals.update(time);
    for (const key of ['vehLamp', 'pedLamp']) {
      assert.deepEqual(current.signals[key].instanceColor.array, reference.signals[key].instanceColor.array);
      current.signals[key].instanceColor.clearUpdateRanges();
    }
  }
  console.log('PASS: signal colors match through two complete cycles');
}
