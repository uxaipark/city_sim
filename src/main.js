import { installProfiler } from './profiler.js';
import { StaticShadowCache } from './static-shadow-cache.js';
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { generateCity, downtown } from './citygen.js';
import { buildTerrain, buildWater } from './terrain.js';
import { buildBuildings, buildSlabs } from './buildings.js';
import { buildRoads, buildBridges, buildPaths } from './roads.js';
import { buildTrees } from './vegetation.js';
import { Traffic } from './traffic.js';
import { People } from './people.js';
import { Subway } from './subway.js';
import { Sky } from './sky.js';
import { Signals } from './signals.js';
import { buildParking } from './parking.js';
import { buildLamps } from './lamps.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SizedBloomPass } from './bloom.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { StreakShader, GrainVignetteShader, TiltShiftShader } from './postfx.js';
import { buildHaze } from './haze.js';
import { buildSignage } from './signage.js';
import { carDensity, pedDensity, highwayDensity, isRushHour } from './schedule.js';

const elements = new Map();
const $ = (id) => {
  if (!elements.has(id)) elements.set(id, document.getElementById(id));
  return elements.get(id);
};
const setText = (id, text) => { const el = $(id); if (el.textContent !== text) el.textContent = text; };

// 공용 유니폼 (모든 셰이더가 참조)
const U = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uLate: { value: 0 },   // 심야 소등 정도 (22시 이후 증가)
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSkyColor: { value: new THREE.Color(0.7, 0.8, 0.9) },
};

const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

// 후처리: MSAA 렌더 타깃 + 블룸(조명 번짐) + 출력(톤매핑/색공간)
const pr = Math.min(devicePixelRatio, 2);
const rt = new THREE.WebGLRenderTarget(innerWidth * pr, innerHeight * pr, { samples: 4, type: THREE.HalfFloatType });
const composer = new EffectComposer(renderer, rt);
// A supplied render target is already in physical pixels. Reset the composer's
// logical size before adding passes so DPR is applied exactly once.
composer.setSize(innerWidth, innerHeight);
const bloom = new SizedBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.45, 1.0, 1, pr);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xcfd8e2, 0.000032);
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 1, 120000);
const HOME = { pos: new THREE.Vector3(1600, 5400, 5600), target: new THREE.Vector3(200, 0, 0) };
camera.position.copy(HOME.pos);

const controls = new MapControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.09;
controls.minDistance = 25; controls.maxDistance = 17000;
controls.maxPolarAngle = Math.PI * 0.495;
controls.zoomSpeed = 1.1;
controls.zoomToCursor = true;
controls.target.copy(HOME.target);

composer.addPass(new RenderPass(scene, camera));
composer.addPass(bloom);                                            // 1) 좁은 블룸
const bloomWide = new SizedBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.1, 1.0, 1.6, 0.5, pr);
composer.addPass(bloomWide);                                        // 1) 넓은 블룸 (다단)
const streak = new ShaderPass(StreakShader); streak.uniforms.uThreshold.value = 1.9; streak.uniforms.uTexel.value = new THREE.Vector2(1 / innerWidth, 1 / innerHeight);
composer.addPass(streak);                                           // 2) 스타버스트 광선
const afterimage = new AfterimagePass(0.9); afterimage.enabled = false;
composer.addPass(afterimage);                                       // 9) 장노출 라이트 트레일 (L 키)
composer.addPass(new OutputPass());
const tilt = new ShaderPass(TiltShiftShader); tilt.uniforms.uTexel.value = new THREE.Vector2(1 / innerWidth, 1 / innerHeight); tilt.enabled = false;
composer.addPass(tilt);                                             // 11) 틸트시프트 (T 키)
const grain = new ShaderPass(GrainVignetteShader);
composer.addPass(grain);                                            // 3) 비네팅 (그레인은 0으로 꺼둠)
// 10) 자동 노출: 저해상도 렌더의 평균 휘도로 노출을 서서히 맞춘다
const expoRT = new THREE.WebGLRenderTarget(24, 24, { type: THREE.FloatType, depthBuffer: true });
const expoBuf = new Float32Array(24 * 24 * 4);
let autoExpo = 1, autoExpoTarget = 1, expoFrame = 0, expoPending = false;
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.near = 200; sun.shadow.camera.far = 14000;
sun.shadow.bias = 0; sun.shadow.normalBias = 0.5; sun.shadow.radius = 2;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x9a7b55, 0.9);
scene.add(hemi);
const sky = new Sky(scene, U, sun, hemi, scene.fog, renderer);
const moon = new THREE.DirectionalLight(0xb9c4e0, 0); scene.add(moon, moon.target); sky.moon = moon;

let profiler;
let city, traffic, people, subway, signals, lamps, buildingsMesh, treesGroup, signage, hazeGroup;
let hour = 15, autoTime = false, simTime = 0, shadowsOn = true;
let follow = null;
const keys = new Set();

function build() {
  city = generateCity(7);
  scene.add(buildTerrain(U));
  scene.add(buildWater(U));
  scene.add(buildSlabs(city, U));
  scene.add(buildRoads(city, U));
  scene.add(buildBridges(city));
  scene.add(buildPaths(city));
  const parking = buildParking(city, U);
  scene.add(parking);
  lamps = buildLamps(city, U);
  scene.add(lamps);
  hazeGroup = buildHaze(U); scene.add(hazeGroup);
  signage = buildSignage(city, U);
  scene.add(signage);
  buildingsMesh = buildBuildings(city, U);
  scene.add(buildingsMesh);
  treesGroup = buildTrees(city, U);
  scene.add(treesGroup);
  signals = new Signals(city);
  scene.add(signals.group);
  traffic = new Traffic(city, U, signals, 18000, 500);
  scene.add(traffic.carMesh, traffic.busMesh);
  people = new People(city, U, signals);
  scene.add(people.mesh);
  subway = new Subway(city);
  scene.add(subway.group);
  const dynamicCasters = new Set([traffic.carMesh, traffic.busMesh]);
  treesGroup.traverse(object => dynamicCasters.add(object));
  // Other current casters are immutable city geometry (including subway entrances).
  const staticCasters = [];
  scene.traverse(object => {
    if (object.isMesh && object.castShadow && !dynamicCasters.has(object)) staticCasters.push(object);
  });
  const shadowCache = new StaticShadowCache(renderer, sun, staticCasters);
  shadowCache.enabled = new URLSearchParams(location.search).get('shadowCache') !== '0';
  window.__nomad = { shadowCache, camera, controls, scene, U, city, composer, trees: treesGroup, passes: { bloom, bloomWide, streak, afterimage, tilt, grain }, haze: hazeGroup, signage, sky, renderer, lamps, traffic, people, subway, signals, atlas: () => buildingsMesh.userData.interior.userData.canvas, setHour: (h) => { hour = h; $('time').value = h; }, setFollow: (i) => { follow = { idx: i }; } };

  if (new URLSearchParams(location.search).has('profile')) profiler = installProfiler(window.__nomad);

  setText('s-b', String(city.buildings.filter((b) => b.main).length.toLocaleString()));
  setText('s-r', String(city.edges.filter((e) => !e.path).length.toLocaleString()));
  setText('s-cmax', String(traffic.n.toLocaleString()));
  setText('s-pmax', String(people.max.toLocaleString()));
  setText('s-t', String(city.trees.length.toLocaleString()));
  setText('s-s', String(city.subwayLines.reduce((a, l) => a + l.stations.length, 0).toLocaleString()));
  setText('s-sig', String(signals.count.toLocaleString()));
  setText('s-park', String(`${city.parkingLots.length.toLocaleString()} (${(parking.userData.parkedCount || 0).toLocaleString()}대)`));
}

// ---------- UI ----------
const fmtClock = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
$('time').addEventListener('input', (e) => { hour = parseFloat(e.target.value); });
$('b-auto').addEventListener('click', (e) => { autoTime = !autoTime; e.target.classList.toggle('on', autoTime); });
$('b-xray').addEventListener('click', (e) => { const on = !subway.xray.visible; subway.setXray(on); e.target.classList.toggle('on', on); });
$('b-shadow').addEventListener('click', (e) => { shadowsOn = !shadowsOn; e.target.classList.toggle('on', shadowsOn); });
$('b-reset').addEventListener('click', () => { follow = null; camera.position.copy(HOME.pos); controls.target.copy(HOME.target); hideInfo(); });
for (const [id, h] of [['b-t13', 13], ['b-t18', 17.55], ['b-t22', 22]]) {
  $(id).addEventListener('click', () => {
    hour = h; $('time').value = h; autoTime = false; $('b-auto').classList.remove('on');
    if (id === 'b-t18') { // 노을: 도심 빌딩 위에서 태양을 바라보는 뷰
      follow = null; hideInfo();
      const th = ((h - 6) / 12) * Math.PI;
      const dir = new THREE.Vector3(Math.cos(th), Math.sin(th) * 0.85, 0.4).normalize();
      camera.position.set(1500, 190, -350);
      controls.target.copy(camera.position).addScaledVector(dir, 2500).setY(190 + 2500 * Math.max(dir.y, 0.02));
      controls.update();
    }
  });
}
// ---------- Spot: 뷰포인트 저장 (10 슬롯, localStorage) ----------
const SPOT_KEY = 'nomad.spots';
function loadSpots() { try { const a = JSON.parse(localStorage.getItem(SPOT_KEY) || '[]'); return Array.from({ length: 10 }, (_, i) => a[i] || null); } catch { return Array(10).fill(null); } }
function saveSpots(list) { try { localStorage.setItem(SPOT_KEY, JSON.stringify(list)); } catch {} }
function renderSpots() {
  const list = loadSpots();
  const el = $('spot-list'); el.innerHTML = '';
  list.forEach((sp, i) => {
    const row = document.createElement('div'); row.className = 'slot';
    const nm = document.createElement('span'); nm.className = 'nm' + (sp ? '' : ' empty');
    nm.textContent = sp ? `${sp.name} · ${fmtClock(sp.hour)}` : '비어 있음';
    const bSave = document.createElement('button'); bSave.textContent = '저장';
    bSave.onclick = () => {
      const name = ($('spot-name').value || '').trim() || `Spot ${i + 1}`;
      const l = loadSpots();
      l[i] = { name, hour, pos: camera.position.toArray(), target: controls.target.toArray() };
      saveSpots(l); $('spot-name').value = ''; renderSpots();
    };
    const bGo = document.createElement('button'); bGo.textContent = '이동'; bGo.className = 'go'; bGo.disabled = !sp;
    const goSpot = () => { if (!sp) return; follow = null; hideInfo(); hour = sp.hour; $('time').value = hour; autoTime = false; $('b-auto').classList.remove('on'); camera.position.fromArray(sp.pos); controls.target.fromArray(sp.target); controls.update(); $('spot-name').value = sp.name; /* 선택한 스팟 이름을 입력창에 복사 (같은 이름으로 다시 저장하기 편하게) */ };
    bGo.onclick = goSpot;
    if (sp) { nm.onclick = goSpot; nm.title = '클릭하면 이동'; } // 이름 텍스트 클릭으로도 이동
    const bDel = document.createElement('button'); bDel.textContent = '삭제'; bDel.disabled = !sp;
    bDel.onclick = () => { const l = loadSpots(); l[i] = null; saveSpots(l); renderSpots(); };
    const num = document.createElement('span'); num.textContent = String(i + 1);
    row.append(num, nm, bSave, bGo, bDel); el.appendChild(row);
  });
}
// Spot 패널은 컨트롤 패널(Spot 버튼) 바로 아래에 붙여서 연다
function placeSpots() { const r = $('ctl').getBoundingClientRect(); const p = $('spots'); p.style.top = `${r.bottom + 8}px`; p.style.right = `${innerWidth - r.right}px`; p.style.width = `${r.width}px`; }
$('b-spot').addEventListener('click', (e) => { const p = $('spots'); p.hidden = !p.hidden; e.target.classList.toggle('on', !p.hidden); if (!p.hidden) { placeSpots(); renderSpots(); } });
window.addEventListener('resize', () => { if (!$('spots').hidden) placeSpots(); });
// 패널 바깥(캔버스·다른 UI)을 클릭하면 Spot 목록 닫기
window.addEventListener('pointerdown', (e) => {
  const p = $('spots'); if (p.hidden) return;
  if (p.contains(e.target) || $('b-spot').contains(e.target)) return;
  p.hidden = true; $('b-spot').classList.remove('on');
}, true);
$('spot-name').addEventListener('keydown', (e) => e.stopPropagation()); // 입력 중 단축키 무시

window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (e.code.startsWith('Arrow')) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'Escape') { follow = null; hideInfo(); }
  if (e.code === 'KeyN') { hour = hour > 6 && hour < 18 ? 22 : 13; $('time').value = hour; }
  if (e.code === 'KeyL') afterimage.enabled = !afterimage.enabled;   // 장노출 라이트 트레일
  if (e.code === 'KeyT') tilt.enabled = !tilt.enabled;               // 틸트시프트
  if (e.code === 'KeyV') { for (const id of ['hud', 'ctl', 'help']) $(id).hidden = !$(id).hidden; if (!$('ctl').hidden === false) $('spots').hidden = true; }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  const pixelRatio = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  bloom.pixelRatio = bloomWide.pixelRatio = pixelRatio;
  composer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  streak.uniforms.uTexel.value.set(1 / innerWidth, 1 / innerHeight);
  tilt.uniforms.uTexel.value.set(1 / innerWidth, 1 / innerHeight);
});

function showInfo(title, body) { $('info').style.display = 'block'; $('info-t').textContent = title; $('info-b').innerHTML = body; }
function hideInfo() { $('info').style.display = 'none'; }

// ---------- 선택 / 추적 ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
let downX = 0, downY = 0;
canvas.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || Math.hypot(e.clientX - downX, e.clientY - downY) > 5 || !city) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const idx = traffic.pick(raycaster.ray, camera.position);
  if (idx >= 0) {
    const isBus = idx >= traffic.maxCars;
    follow = { idx };
    const e = traffic.edges[traffic.edge[idx]];
    showInfo(isBus ? '🚌 버스 추적 중' : '🚗 차량 추적 중', `${e.wide ? '대로' : '골목'} 주행 · 차선 ${traffic.lane[idx] + 1}<br>ESC 로 추적 해제`);
    return;
  }
  const bh = raycaster.intersectObject(buildingsMesh, false);
  if (bh.length) {
    const b = city.buildings[bh[0].instanceId];
    const total = b.y + b.h;
    const dt = downtown(b.x, b.z);
    const district = dt > 0.6 ? '중심업무지구 (CBD)' : dt > 0.3 ? '상업지구' : '주거지구';
    showInfo('🏢 건물', `높이 ${Math.round(total)} m · 약 ${Math.max(1, Math.round(total / 3.5))}층<br>${district}<br>위치 ${Math.round(b.x)}, ${Math.round(b.z)}`);
    follow = null;
    return;
  }
  follow = null; hideInfo();
});
canvas.addEventListener('pointermove', (e) => {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (raycaster.ray.intersectPlane(groundPlane, hit)) {
    $('coord').textContent = `E ${(hit.x / 1000).toFixed(2)} km · S ${(hit.z / 1000).toFixed(2)} km`;
  }
});

// ---------- 루프 ----------
const clock = new THREE.Timer();
const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), offset = new THREE.Vector3();
let fpsAcc = 0, fpsN = 0, fpsT = 0;
let densityHour, cd, pd, hd, displayedHour;

// Async readback avoids blocking the CPU until the GPU finishes the frame.
function measureExposure() {
  expoPending = true;
  renderer.readRenderTargetPixelsAsync(expoRT, 0, 0, 24, 24, expoBuf).then(() => {
    // NaN/Infinity 픽셀(태양 원반 등 극단값)이 섞이면 노출이 NaN 이 되어 화면이 전부 검게 되므로 유효 픽셀만, 값도 상한을 둔다
    let sum = 0, cnt = 0;
    for (let i = 0; i < expoBuf.length; i += 4) {
      const l = 0.2126 * expoBuf[i] + 0.7152 * expoBuf[i + 1] + 0.0722 * expoBuf[i + 2];
      if (Number.isFinite(l)) { sum += Math.log(0.001 + Math.min(l, 40)); cnt++; }
    }
    if (cnt > 0) {
      const avg = Math.exp(sum / cnt);
      const t = Math.min(1.1, Math.max(0.6, 0.35 / Math.max(avg, 0.01)));
      if (Number.isFinite(t)) autoExpoTarget = t;
    }
  }).catch((error) => {
    console.warn('Exposure readback failed; retaining previous exposure', error);
  }).finally(() => { expoPending = false; });
}

function frame() {
  requestAnimationFrame(frame);
  clock.update();
  const elapsed = clock.getDelta();
  profiler?.beginFrame(elapsed);
  const dt = Math.min(elapsed, 0.05);
  simTime += dt;
  U.uTime.value = simTime;
  if (autoTime) { hour = (hour + dt / 30) % 24; $('time').value = hour; }
  if (displayedHour !== hour) { setText('clock', fmtClock(hour)); displayedHour = hour; }
  sky.update(hour, camera);
  U.uLate.value = hour >= 22 ? Math.min(1, (hour - 22) / 3) : hour < 5 ? 1 : hour < 6.5 ? 1 - (hour - 5) / 1.5 : 0;

  // 키보드 이동
  const dist = camera.position.distanceTo(controls.target);
  if (keys.size) {
    fwd.subVectors(controls.target, camera.position); fwd.y = 0; fwd.normalize();
    right.crossVectors(fwd, THREE.Object3D.DEFAULT_UP);
    tmp.set(0, 0, 0);
    if (keys.has('KeyW')) tmp.add(fwd); if (keys.has('KeyS')) tmp.sub(fwd);
    if (keys.has('KeyD')) tmp.add(right); if (keys.has('KeyA')) tmp.sub(right);
    if (tmp.lengthSq() > 0) { tmp.normalize().multiplyScalar(dist * 0.9 * dt); camera.position.add(tmp); controls.target.add(tmp); follow = null; }
    // 위/아래: 고도 조절, 좌/우: 현재 위치(시점 기준점) 중심 회전
    if (keys.has('ArrowUp') || keys.has('ArrowDown')) {
      // 순수 수직 이동: 카메라와 시점 기준점을 함께 위/아래로 (속도는 현재 고도에 비례)
      const dy = (keys.has('ArrowUp') ? 1 : -1) * (Math.abs(camera.position.y) * 0.9 + 15) * dt;
      if (camera.position.y + dy > 3) { camera.position.y += dy; controls.target.y += dy; }
    }
    if (keys.has('ArrowLeft') || keys.has('ArrowRight')) {
      const ang = (keys.has('ArrowLeft') ? 1 : -1) * 1.1 * dt;
      offset.subVectors(camera.position, controls.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, ang);
      camera.position.copy(controls.target).add(offset);
    }
  }

  // 차량 추적
  if (follow) {
    offset.subVectors(camera.position, controls.target);
    traffic.positionOf(follow.idx, tmp);
    controls.target.lerp(tmp, 0.25);
    camera.position.copy(controls.target).add(offset);
  }
  controls.update();

  // 그림자 프러스텀은 카메라 주변만 추적
  sun.castShadow = shadowsOn && sky.elevation > 0.04 && dist < 9000;
  const ext = Math.min(4200, Math.max(220, dist * 1.3));
  const sc = sun.shadow.camera;
  if (sc.left !== -ext || sc.right !== ext || sc.top !== ext || sc.bottom !== -ext) {
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
    sc.updateProjectionMatrix();
  }
  sun.target.position.copy(controls.target);
  sun.position.copy(controls.target).addScaledVector(U.uSunDir.value, 5000);
  sun.target.updateMatrixWorld();

  // 시간대별 밀도 (러시아워 포함)
  if (densityHour !== hour) {
    cd = carDensity(hour); pd = pedDensity(hour); hd = highwayDensity(hour);
    traffic.setDensity(cd, hd); people.setDensity(pd);
    densityHour = hour;
  }
  signals.update(simTime);
  people.mesh.visible = dist < 2600;
  people.update(dt, controls.target, !people.mesh.visible);
  traffic.update(dt, simTime, people.nodeCross);
  people.updateRender(camera);
  subway.update(dt);

  lamps.userData.update();
  const night = U.uNight.value;
  bloom.strength = 0.12 + 0.45 * night * night + 0.35 * sky.uniforms.uDusk.value * sky.uniforms.uSunUp.value;
  bloomWide.strength = 0.03 + 0.12 * night;
  streak.uniforms.uStrength.value = 0.1 + 0.3 * night;
  grain.uniforms.uTime.value = simTime; grain.uniforms.uGrain.value = 0.0; // 그레인(지글거림) 제거 요청 grain.uniforms.uVignette.value = 0.22 + 0.2 * night;
  // Render the exposure sample after the main view to reuse this frame's shadows.
  autoExpo += (autoExpoTarget - autoExpo) * Math.min(1, dt * 1.2);
  if (!Number.isFinite(autoExpo)) autoExpo = 1;
  renderer.toneMappingExposure = (Number.isFinite(sky.baseExposure) ? sky.baseExposure : 1) * autoExpo;
  treesGroup.userData.update(camera, sun);
  profiler?.beforeRender();
  composer.render();
  if (++expoFrame % 15 === 0 && !expoPending) {
    const prevTM = renderer.toneMapping;
    const prevAuto = renderer.shadowMap.autoUpdate;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.autoUpdate = false;
    try {
      renderer.setRenderTarget(expoRT);
      renderer.render(scene, camera);
    } finally {
      renderer.setRenderTarget(null);
      renderer.toneMapping = prevTM;
      renderer.shadowMap.autoUpdate = prevAuto;
    }
    measureExposure();
  }

  fpsAcc += elapsed; fpsN++;
  if ((fpsT += elapsed) > 0.5) {
    setText('s-fps', String(Math.round(fpsN / fpsAcc)));
    setText('s-c', String(`${traffic.activeCount.toLocaleString()} (고속 ${traffic.highwayCount.toLocaleString()})`));
    setText('s-p', String(people.active.toLocaleString()));
    setText('s-dens', String(`${Math.round(cd * 100)}%${isRushHour(hour) ? ' · 러시아워' : ''}`));
    const densityColor = isRushHour(hour) ? 'rgb(240, 179, 90)' : '';
    if ($('s-dens').style.color !== densityColor) $('s-dens').style.color = densityColor;
    setText('s-alt', String(camera.position.y > 1000 ? `${(camera.position.y / 1000).toFixed(1)} km` : `${Math.round(camera.position.y)} m`));
    fpsAcc = fpsN = fpsT = 0;
  }
  profiler?.endFrame();
}

setTimeout(async () => {
  build();
  const l = $('loading');
  l.style.opacity = '0';
  setTimeout(() => l.remove(), 650);
  if (new URLSearchParams(location.search).get('verify') === 'shadows') {
    const { verifyShadows } = await import('../scripts/shadowcheck-browser.mjs');
    const result = await verifyShadows(window.__nomad);
    console.info('Shadow verification result:', JSON.stringify(result));
  }
  frame();
}, 30);
