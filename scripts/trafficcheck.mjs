// node scripts/trafficcheck.mjs /absolute/path/to/pre-change/src
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { generateCity } from '../src/citygen.js';
import { Traffic } from '../src/traffic.js';
import { Signals } from '../src/signals.js';
import { Sky } from '../src/sky.js';
import { mulberry32 } from '../src/noise.js';

assert(process.argv[2], 'Pass the pre-change source directory');
const load = name => import(pathToFileURL(`${process.argv[2]}/${name}.js`));
const { Traffic: Before } = await load('traffic');
const { Sky: BeforeSky } = await load('sky');
const rng = mulberry32(519);

const city = generateCity(7), signals = new Signals(city), U = {uNight:{value:0}};
const current = new Traffic(city,U,signals,18000,500), before = new Before(city,U,signals,18000,500);
const cross = new Uint8Array(city.nodes.length * 2), durations = [[], []];
const run = (traffic, frame, dt) => {
  const start = performance.now(); traffic.update(dt,frame*.05,cross); const elapsed = performance.now()-start;
  traffic.carMesh.instanceMatrix.clearUpdateRanges(); traffic.busMesh.instanceMatrix.clearUpdateRanges();
  return elapsed;
};
for (let frame = 0; frame < 1200; frame++) {
  const phase = Math.floor(frame / 120);
  const density = [.2,.7,.95,.45,.7][phase%5], highway = [.9,.1,.8,0,1][phase%5];
  for (const traffic of [current,before]) traffic.setDensity(density,highway);
  signals.update(frame*.05);
  cross.fill(0);
  if (frame%100 < 40) for (let n = 0; n < cross.length; n += 7) cross[n] = 1;
  const dt = [.05,1/60,.033][frame%3];
  let a,b;
  if (frame%2) { a=run(current,frame,dt); b=run(before,frame,dt); }
  else { b=run(before,frame,dt); a=run(current,frame,dt); }
  if (frame>=240) { durations[0].push(a); durations[1].push(b); }
  if (frame%30===0 || frame===1199) {
    for (const key of ['t','v','edge','dir','lane','laneFrom','lat','nextEdge','nextDir','nextLane','turn','inTurn','u','curve','curveL','yaw','grid','cellRear','cellV','nodeTurn'])
      assert.deepEqual(current[key],before[key],`${key} at ${frame}`);
    for (const name of ['carMesh','busMesh']) assert.deepEqual(current[name].instanceMatrix.array,before[name].instanceMatrix.array,`${name} at ${frame}`);
  }
}
assert.equal(current.rng(),before.rng());
console.log('PASS: 1200 frames; state, matrices, occupancy, routes and RNG identical across density/crosswalk changes');

function makeSky(C) {
  const scene=new THREE.Scene(), sun=new THREE.DirectionalLight(), hemi=new THREE.HemisphereLight();
  const uniforms={uTime:{value:0},uSunDir:{value:new THREE.Vector3()},uNight:{value:0},uSkyColor:{value:new THREE.Color()}};
  const sky=new C(scene,uniforms,sun,hemi,new THREE.FogExp2(),{}); sky.moon=new THREE.DirectionalLight();
  return sky;
}
const sky=makeSky(Sky), oldSky=makeSky(BeforeSky), camera=new THREE.PerspectiveCamera();
for (const hour of [15,15,15,22,22,17.55,17.55,0,6,12,15]) {
  camera.position.set(rng()*1000,rng()*1000,rng()*1000);
  sky.update(hour,camera); oldSky.update(hour,camera);
  for (const key of ['elevation','baseExposure']) assert.equal(sky[key],oldSky[key]);
  for (const key of Object.keys(sky.uniforms)) assert.deepEqual(sky.uniforms[key].value,oldSky.uniforms[key].value);
  assert.deepEqual(sky.dome.position,oldSky.dome.position);
  assert.deepEqual(sky.fog,oldSky.fog);
  for (const name of ['sun','hemi','moon']) {
    assert.deepEqual(sky[name].color,oldSky[name].color);
    assert.equal(sky[name].intensity,oldSky[name].intensity);
    assert.deepEqual(sky[name].position,oldSky[name].position);
  }
}
console.log('PASS: lighting and moving sky dome unchanged when time is fixed or changed');
const stats = values => {
  values.sort((a,b)=>a-b);
  return {meanMs:values.reduce((a,b)=>a+b,0)/values.length,medianMs:values[Math.floor(values.length*.5)],p95Ms:values[Math.floor(values.length*.95)]};
};
const report={frames:1200,measuredFrames:960,after:stats(durations[0]),before:stats(durations[1])};
console.log(JSON.stringify(report,null,2));
await writeFile('profiles/traffic-45811.json',JSON.stringify(report,null,2));
