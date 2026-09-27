// node scripts/spatialcheck.mjs /absolute/path/to/pre-change/src
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { generateCity } from '../src/citygen.js';
import { People } from '../src/people.js';
import { Signals } from '../src/signals.js';
import { buildTrees } from '../src/vegetation.js';
import { SizedBloomPass } from '../src/bloom.js';
const dir = process.argv[2];
assert(dir, 'Pass the pre-change source directory');
const old = await import(pathToFileURL(`${dir}/people.js`));
const oldTrees = await import(pathToFileURL(`${dir}/vegetation.js`));
const city = generateCity(7), U = { uTime:{value:0} }, signals = new Signals(city);
const current = new People(city,U,signals), reference = new old.People(city,U,signals);
const camera = new THREE.PerspectiveCamera(48,1344/836,1,120000);
const focus = new THREE.Vector3();
let simNew=0, simOld=0, renderNew=0, renderOld=0, renderFrames=0;
for(let frame=0;frame<900;frame++) {
  const phase=Math.floor(frame/90);
  focus.set(phase%2 ? -1800 : 500,0,phase%3 ? -1100 : 1700);
  if(frame%180>=90) focus.x += (frame%90)*2;
  const density=[0.2,0.7,0.95][phase%3], simOnly=frame%120<60;
  current.setDensity(density); reference.setDensity(density);
  signals.update(frame*.05);
  let start=performance.now(); current.update(.05,focus,simOnly); simNew+=performance.now()-start;
  start=performance.now(); reference.update(.05,focus,simOnly); simOld+=performance.now()-start;
  for(const m of [signals.vehLamp,signals.pedLamp]) m.instanceColor.clearUpdateRanges();
  if(frame%30===0) {
    for(const key of ['edge','dir','t','off','offT','nextEdge','nextDir','nextOff','kind','crossing','crossNode','crossAxis','crossEndT','nodeCross','positions'])
      assert.deepEqual(current[key],reference[key],`${key} at frame ${frame}`);
    for(let c=0;c<current.max;c++) assert.equal(!!(current.nearPeople[c>>>5] & (1<<(c&31))),!!current.nearEdge[current.edge[c]]);
    // Include both narrow ground views and wide aerial views, including stale simOnly positions.
    camera.position.set(focus.x+300,frame%60 ? 120 : 1500,focus.z+400);
    camera.lookAt(focus);
    current.mesh.visible=reference.mesh.visible=true;
    start=performance.now(); current.updateRender(camera); renderNew+=performance.now()-start;
    start=performance.now(); reference.updateRender(camera); renderOld+=performance.now()-start;
    renderFrames++;
    assert.equal(current.mesh.count,reference.mesh.count);
    const n=current.mesh.count;
    assert.deepEqual(current.renderIds.subarray(0,n),reference.renderIds.subarray(0,n));
    assert.deepEqual(current.mesh.instanceMatrix.array.subarray(0,n*16),reference.mesh.instanceMatrix.array.subarray(0,n*16));
    assert.deepEqual(current.mesh.instanceColor.array.subarray(0,n*3),reference.mesh.instanceColor.array.subarray(0,n*3));
    for(const p of [current,reference]) { p.mesh.instanceMatrix.clearUpdateRanges();p.mesh.instanceColor.clearUpdateRanges(); }
  }
}
for(const index of [current.edgeMembers,current.renderMembers]) {
  const seen=new Uint8Array(current.max);
  for(let b=0;b<index.head.length;b++) {
    let previous=-1;
    for(let c=index.head[b];c!==-1;c=index.next[c]) {
      assert.equal(seen[c]++,0);assert.equal(index.prev[c],previous);assert.equal(index.bucket[c],b);previous=c;
    }
  }
  assert(seen.every(n=>n===1));
}
console.log('PASS: 900 frames, 45 simulated seconds; density changes, moving/teleporting focus, hidden/visible state, RNG order, render IDs/colors/matrices and bucket membership');
console.log(JSON.stringify({pedestrianSimulationMs:{before:simOld/900,after:simNew/900},pedestrianRenderingMs:{before:renderOld/renderFrames,after:renderNew/renderFrames}}));

const trees=buildTrees(city,U), original=oldTrees.buildTrees(city,U);
let chunkCount=0;
const localSphere=new THREE.Sphere(), matrix=new THREE.Matrix4();
for(const {full,chunks} of trees.userData.batches) {
  const oldMesh=original.children[full.userData.kind];
  assert.deepEqual(full.instanceMatrix.array,oldMesh.instanceMatrix.array);
  assert.deepEqual(full.instanceColor.array,oldMesh.instanceColor.array);
  const seen=new Set();
  for(const chunk of chunks.children) {
    chunkCount++;
    assert.equal(chunk.material,full.material);assert.equal(chunk.geometry,full.geometry);
    for(let i=0;i<chunk.count;i++) {
      const id=chunk.userData.sourceIds[i];assert(!seen.has(id));seen.add(id);
      assert.deepEqual(chunk.instanceMatrix.array.subarray(i*16,i*16+16),full.instanceMatrix.array.subarray(id*16,id*16+16));
      assert.deepEqual(chunk.instanceColor.array.subarray(i*3,i*3+3),full.instanceColor.array.subarray(id*3,id*3+3));
      chunk.getMatrixAt(i,matrix);localSphere.copy(chunk.geometry.boundingSphere).applyMatrix4(matrix);localSphere.radius+=2;
      assert(localSphere.center.distanceTo(chunk.boundingSphere.center)+localSphere.radius <= chunk.boundingSphere.radius+1e-4);
    }
  }
  assert.equal(seen.size,full.count);
}
const sun=new THREE.DirectionalLight();sun.castShadow=true;
sun.shadow.camera.near=200;sun.shadow.camera.far=14000;
for(const [name,pos,target,extent] of [['home',[1600,5400,5600],[200,0,0],4200],['close',[500,200,-800],[500,0,-1100],468]]) {
  camera.position.set(...pos);camera.lookAt(...target);
  sun.target.position.set(...target);sun.position.copy(sun.target.position).add(new THREE.Vector3(3000,3800,1200));
  Object.assign(sun.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent});sun.shadow.camera.updateProjectionMatrix();
  trees.userData.update(camera,sun);
  for(const {full,chunks} of trees.userData.batches) assert.notEqual(full.visible,chunks.visible);
  console.log('trees',name,'submitted instances (view + shadow)',trees.userData.submittedInstances,'draws',trees.userData.draws);
}
console.log('PASS: tree transforms/colors/count preserved, shared resources, conservative wind bounds;',chunkCount,'spatial batches');
for(const dpr of [1,1.5,2]) {
  for(const scale of [1,.5]) {
    const bloom=new SizedBloomPass(new THREE.Vector2(800,600),.5,.45,1,scale,dpr);
    for(const [width,height] of [[800,600],[1344,836],[400,900]]) {
      bloom.setSize(width*dpr,height*dpr);
      assert.equal(bloom.renderTargetBright.width,Math.round(Math.round(width*dpr*scale)/2));
      assert.equal(bloom.renderTargetBright.height,Math.round(Math.round(height*dpr*scale)/2));
      const value=bloom.separableBlurMaterials[0].uniforms.invSize.value.x;
      assert(Math.abs(value-(1/(width*dpr*dpr/2)))<.0001);
    }
    bloom.dispose();
  }
}
console.log('PASS: bloom DPR 1/1.5/2, repeated resizing, half-size wide halo and compensated blur footprint');
