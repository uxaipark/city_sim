import assert from 'node:assert/strict';
import { installProfiler } from '../src/profiler.js';
const received = [];
globalThis.location = { search:'?profile=1' };
globalThis.window = {};
globalThis.innerWidth = 1344; globalThis.innerHeight = 836; globalThis.devicePixelRatio = 2;
globalThis.document = { hidden:false, createElement:()=>({style:{}}), body:{append(){}} };
globalThis.fetch = async (_url, options) => {received.push(JSON.parse(options.body));};
const pass = () => ({ enabled:true, render(){}, setSize(){},renderTargetBright:{width:2688,height:1672} });
const all = Array.from({length:8},pass);
all[4].enabled = all[6].enabled = false;
const vector = () => ({set(){}});
const update = () => ({update(){}});
const renderer = {render(){},getRenderTarget:()=>null,getContext:()=>({getExtension:()=>null,getParameter:()=>'',drawingBufferWidth:2688,drawingBufferHeight:1672}),shadowMap:{enabled:true,render(){}},info:{autoReset:true,reset(){},render:{calls:100,triangles:20000000}}};
const api = { renderer,composer:{passes:all,_width:2688,_height:1672,_pixelRatio:2,renderTarget1:{width:2688,height:1672,samples:4}},
  camera:{position:vector()},controls:{target:vector(),update(){}},
  passes:{bloom:all[1],bloomWide:all[2],streak:all[3],afterimage:all[4],tilt:all[6],grain:all[7]},
  people:{...update(),updateRender(){},mesh:{visible:true,count:600}},traffic:update(),signals:update(),sky:update(),subway:update(),
  scene:{children:[{visible:true,userData:{species:[]}},{visible:true,userData:{interior:{}}}]},setHour(){} };
const profiler=installProfiler(api);
for(let i=0;i<13*180;i++) {
  profiler.beginFrame(1/30);
  api.people.mesh.visible=true; api.traffic.update(); api.people.update(); profiler.beforeRender();
  for(const p of all) if(p.enabled) p.render();
  profiler.endFrame();
}
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(received.length,13);
assert(received.every(r=>r.frameMs.n===120 && r.frameCpuMs.n===120));
assert(received.every(r=>Number.isFinite(r.fps)));
assert.equal(received.find(r=>r.scenario==='day-close-no-pedestrians').peopleRendered.mean,0);
assert.equal(renderer.info.autoReset,true);
assert.equal(renderer.shadowMap.enabled,true);
assert.deepEqual(all.map(p=>p.enabled),[true,true,true,true,false,true,false,true]);
assert(api.scene.children.every(o=>o.visible));
console.log('PASS: 13 complete scenarios, 120 samples each, render exclusions and restoration');
