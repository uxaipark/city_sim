import inspector from 'node:inspector';
import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { generateCity } from '../src/citygen.js';
import { Traffic } from '../src/traffic.js';
import { People } from '../src/people.js';
import { Signals } from '../src/signals.js';
import { carDensity, pedDensity, highwayDensity } from '../src/schedule.js';
const city = generateCity(7), U = { uTime:{value:0},uNight:{value:0} };
const signals = new Signals(city), traffic = new Traffic(city,U,signals,18000,500), people = new People(city,U,signals);
traffic.setDensity(carDensity(15),highwayDensity(15)); people.setDensity(pedDensity(15));
const focus = new THREE.Vector3(200,0,0);
let randomCalls = 0;
for (const object of [traffic,people]) { const original=object.rng; object.rng=() => {randomCalls++;return original();}; }
function step(i) {
  signals.update(i/60); people.update(1/60,focus,true); traffic.update(1/60,i/60,people.nodeCross);
  for (const attr of [signals.vehLamp.instanceColor,signals.pedLamp.instanceColor,traffic.carMesh.instanceMatrix,traffic.busMesh.instanceMatrix]) attr.clearUpdateRanges();
}
for (let i=0;i<120;i++) step(i);
randomCalls=0;
const session=new inspector.Session(); session.connect();
const post=(method,params={})=>new Promise((resolve,reject)=>session.post(method,params,(err,result)=>err?reject(err):resolve(result)));
await post('Profiler.enable'); await post('Profiler.setSamplingInterval',{interval:1000}); await post('Profiler.start');
const start=performance.now();
for(let i=120;i<720;i++) step(i);
const elapsed=performance.now()-start;
const {profile}=await post('Profiler.stop'); session.disconnect();
const counts=new Map();
for(let i=0;i<profile.samples.length;i++) counts.set(profile.samples[i],(counts.get(profile.samples[i])||0)+(profile.timeDeltas[i]||0));
const total=[...counts.values()].reduce((a,b)=>a+b,0);
const top=profile.nodes.map(n=>({name:n.callFrame.functionName||'(anonymous)',file:n.callFrame.url,line:n.callFrame.lineNumber+1,selfMs:(counts.get(n.id)||0)/1000,percent:100*(counts.get(n.id)||0)/total})).sort((a,b)=>b.selfMs-a.selfMs).slice(0,30);
const result={frames:600,elapsedMs:elapsed,msPerFrame:elapsed/600,randomCalls,randomCallsPerFrame:randomCalls/600,top};
await mkdir('profiles',{recursive:true});
await writeFile('profiles/simulation.cpuprofile',JSON.stringify(profile));
await writeFile('profiles/cpu-summary.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
