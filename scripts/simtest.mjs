import { generateCity } from '../src/citygen.js';
import { Signals } from '../src/signals.js';
import { Traffic } from '../src/traffic.js';
import { People } from '../src/people.js';
import * as THREE from 'three';
const U = { uTime:{value:0}, uNight:{value:0} };
let t0 = performance.now();
const city = generateCity(7);
console.log('city', (performance.now()-t0)|0, 'ms nodes', city.nodes.length, 'edges', city.edges.length);
t0 = performance.now();
const signals = new Signals(city);
console.log('signals', (performance.now()-t0)|0, 'ms', signals.count);
t0 = performance.now();
const traffic = new Traffic(city, U, signals, 55000, 1500);
console.log('traffic ctor', (performance.now()-t0)|0, 'ms');
t0 = performance.now();
const people = new People(city, U, signals, 180000);
console.log('people ctor', (performance.now()-t0)|0, 'ms');
const focus = new THREE.Vector3(500, 0, -1100);
for (let i = 0; i < 5; i++) {
  t0 = performance.now(); signals.update(i*0.016); const a = performance.now()-t0;
  t0 = performance.now(); people.update(0.016, focus, false); const b = performance.now()-t0;
  t0 = performance.now(); traffic.update(0.016, i*0.016, people.nodeCross); const c = performance.now()-t0;
  console.log('frame', i, 'signals', a.toFixed(1), 'people', b.toFixed(1), 'traffic', c.toFixed(1));
}
let nan = 0; for (let c = 0; c < traffic.n; c++) if (!Number.isFinite(traffic.t[c]) || !Number.isFinite(traffic.v[c])) nan++;
console.log('nan cars', nan, 'inTurn', traffic.inTurn.reduce((a,b)=>a+b,0));
// 장시간 실행 검사
let tt = 0; const dt = 1/60; t0 = performance.now();
let maxT = 0, maxP = 0;
for (let i = 0; i < 900; i++) {
  tt += dt; signals.update(tt); 
  let a = performance.now(); people.update(dt, focus, false); maxP = Math.max(maxP, performance.now()-a);
  a = performance.now(); traffic.update(dt, tt, people.nodeCross); maxT = Math.max(maxT, performance.now()-a);
}
console.log('900 frames', (performance.now()-t0)|0, 'ms, max traffic', maxT.toFixed(1), 'max people', maxP.toFixed(1));
nan = 0; let moving = 0, turning = 0; for (let c = 0; c < traffic.activeCount; c++) { if (!Number.isFinite(traffic.t[c]) || !Number.isFinite(traffic.v[c])) nan++; if (traffic.v[c] > 0.5) moving++; if (traffic.inTurn[c]) turning++; }
console.log('nan', nan, 'moving', moving, '/', traffic.activeCount, 'turning', turning);
let pn = 0, pc = 0; for (let c = 0; c < people.active; c++) { if (!Number.isFinite(people.t[c]) || !Number.isFinite(people.off[c])) pn++; if (people.crossing[c]) pc++; }
console.log('people nan', pn, 'crossing', pc, 'nodeCross sum', people.nodeCross.reduce((a,b)=>a+b,0));
