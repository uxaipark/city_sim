// 차량 시뮬레이션 (대규모)
//  - 도로 그래프 주행, 차선 점유 격자 기반 차간 거리, 신호등/보행자 양보
//  - 교차로 회전: 2차 베지어 곡선을 따라 부드럽게 회전, 차선 변경은 횡방향 보간
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';
import { speedFactor } from './schedule.js';
import { bridgeY } from './citygen.js';
import { vehicleAllowed } from './signals.js';

const CAR_COLORS = [
  [0.92, 0.92, 0.92], [0.92, 0.92, 0.92], [0.10, 0.10, 0.11], [0.75, 0.76, 0.78], [0.75, 0.76, 0.78],
  [0.70, 0.12, 0.10], [0.15, 0.25, 0.55], [0.12, 0.18, 0.30], [0.85, 0.65, 0.15], [0.30, 0.32, 0.34], [0.45, 0.55, 0.45],
];
const BUS_COLORS = [[0.15, 0.45, 0.80], [0.20, 0.60, 0.30], [0.90, 0.70, 0.15], [0.85, 0.85, 0.85]];
const CELL = 5; // 차선 점유 격자 셀 (m)
const CAR_Y = 0.12;
const LANE_TAN = 0.18;
// IDM (지능형 운전자 모델): 앞차 거리·상대속도로 가속도 결정 → 안전거리 유지, 유령 정체 억제
const IDM_A = 2.2, IDM_B = 3.5, IDM_S0 = 3.0, IDM_T = 1.1;
function idmAccel(v, v0, gap, dv) {
  const sStar = IDM_S0 + Math.max(0, v * IDM_T + (v * dv) / (2 * Math.sqrt(IDM_A * IDM_B)));
  const free = 1 - Math.pow(v / Math.max(v0, 0.1), 4);
  return IDM_A * (free - (sStar / Math.max(gap, 0.5)) ** 2);
} // 차선 변경 조향각 tan (전진량 대비 횡이동 비율)

function vehicleMaterial(U, halfW, halfLen, cabinY) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.3 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uNight = U.uNight;
    s.uniforms.uDims = { value: new THREE.Vector3(halfW, halfLen, cabinY) };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal; uniform float uNight; uniform vec3 uDims; vec3 gVehEmissive = vec3(0.0);')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          diffuseColor.rgb *= mix(1.0, 0.3, step(uDims.z, vLocal.y));
          float band = step(0.35, vLocal.y) * step(vLocal.y, 0.9) * step(0.3, abs(vLocal.x) / uDims.x);
          float fr = smoothstep(uDims.y - 0.3, uDims.y - 0.05, vLocal.z) * band;
          float bk = (1.0 - smoothstep(-uDims.y + 0.05, -uDims.y + 0.3, vLocal.z)) * band;
          gVehEmissive = (vec3(1.0, 0.88, 0.62) * fr * 4.0 + vec3(1.0, 0.08, 0.04) * bk * 2.5) * uNight;
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gVehEmissive;');
  };
  mat.customProgramCacheKey = () => 'vehicle';
  return mat;
}
function carGeometry() {
  const body = new THREE.BoxGeometry(1.8, 0.55, 4.3); body.translate(0, 0.55, 0);
  const cabin = new THREE.BoxGeometry(1.6, 0.55, 2.1); cabin.translate(0, 1.1, -0.3);
  return mergeGeometries([body, cabin]);
}
function busGeometry() { const g = new THREE.BoxGeometry(2.5, 3.0, 11); g.translate(0, 1.6, 0); return g; }

export class Traffic {
  constructor(city, U, signals, maxCars = 55000, maxBuses = 1500) {
    this.city = city; this.edges = city.edges; this.signals = signals;
    const rng = mulberry32(1234);
    this.rng = rng;
    const E = city.edges.length;
    this.eAx = new Float32Array(E); this.eAz = new Float32Array(E); this.eBx = new Float32Array(E); this.eBz = new Float32Array(E);
    this.eLen = new Float32Array(E); this.eWide = new Uint8Array(E); this.eAxis = new Uint8Array(E);
    this.eAid = new Int32Array(E); this.eBid = new Int32Array(E);
    this.eHcA = new Float32Array(E); this.eHcB = new Float32Array(E); // 각 끝 노드에서의 교차로 반폭
    this.eDx = new Float32Array(E); this.eDz = new Float32Array(E); this.eYa = new Float32Array(E); this.eYb = new Float32Array(E); this.eBridge = new Uint8Array(E);
    this.eHighway = new Uint8Array(E); this.eRamp = new Uint8Array(E);
    this.laneOff = new Int32Array(E + 1);
    this.eCells = new Int32Array(E);
    this.laneBase = new Int32Array(E * 6);
    let cells = 0;
    for (const e of city.edges) {
      const id = e.id;
      this.eAx[id] = e.a.x; this.eAz[id] = e.a.z; this.eBx[id] = e.b.x; this.eBz[id] = e.b.z;
      this.eLen[id] = e.length; this.eWide[id] = e.wide ? 1 : 0; this.eAxis[id] = e.axis;
      this.eAid[id] = e.a.id; this.eBid[id] = e.b.id;
      this.eHcA[id] = e.a.poly ? 1.5 : (e.axis === 0 ? e.a.wv : e.a.wh) / 2;
      this.eHcB[id] = e.b.poly ? 1.5 : (e.axis === 0 ? e.b.wv : e.b.wh) / 2;
      this.eDx[id] = (e.b.x - e.a.x) / e.length; this.eDz[id] = (e.b.z - e.a.z) / e.length;
      this.eYa[id] = e.a.y || 0; this.eYb[id] = e.b.y || 0; this.eBridge[id] = e.bridge ? 1 : 0;
      this.eHighway[id] = e.highway ? 1 : 0; this.eRamp[id] = e.ramp ? 1 : 0;
      this.laneOff[id] = cells;
      const count = this.eCells[id] = Math.ceil(e.length / CELL);
      for (let lane = 0; lane < 6; lane++) this.laneBase[id * 6 + lane] = cells + lane * count;
      cells += 6 * count;
    }
    // Immutable road frames are reused by every vehicle instead of allocating arrays.
    this.roadFrames = city.edges.map((e) => [
      [this.eAx[e.id], this.eAz[e.id], this.eDx[e.id], this.eDz[e.id]],
      [this.eBx[e.id], this.eBz[e.id], -this.eDx[e.id], -this.eDz[e.id]],
    ]);
    this.turnPosition = new THREE.Vector3();
    this.laneOff[E] = cells;
    this.grid = new Uint8Array(cells);
    this.cellRear = new Float32Array(cells); // 셀을 점유한 차량의 꼬리 위치 (엣지 좌표)
    this.cellV = new Float32Array(cells);    // 그 차량의 속도
    const roadEdges = city.edges.filter((e) => !e.path && !e.ramp); // 램프(일방통행)에는 초기 배치하지 않음
    const wideEdges = roadEdges.filter((e) => e.wide);
    const hwEdges = roadEdges.filter((e) => e.highway);
    const hwElev = hwEdges.filter((e) => e.elevated), hwRadial = hwEdges.filter((e) => !e.elevated);
    this.speedFac = 1;
    this.routeChoices = new Array(E * 6);
    const n = (this.n = maxCars + maxBuses);
    this.maxCars = maxCars; this.maxBuses = maxBuses;
    // 고속도로 전용 차량군: 인덱스 [0, hwCount) — 고속도로에서만 주행, 별도 시간대 곡선
    this.hwCount = hwEdges.length ? Math.round(maxCars * 0.10) : 0; // 고속도로 용량에 맞춘 비율
    this.activeHw = this.hwCount;
    this.renderedActiveHw = this.hwCount;
    this.activeRanges = [[0, this.hwCount], [this.hwCount, maxCars], [maxCars, maxCars + maxBuses]];
    this.activeCars = maxCars; this.activeBuses = maxBuses;
    this.edge = new Int32Array(n); this.dir = new Uint8Array(n); this.lane = new Uint8Array(n); this.laneFrom = new Uint8Array(n);
    this.lat = new Float32Array(n); // 현재 횡방향 오프셋 (m)
    this.nextEdge = new Int32Array(n); this.nextDir = new Uint8Array(n); this.nextLane = new Uint8Array(n); this.turn = new Uint8Array(n);
    this.t = new Float32Array(n); this.v = new Float32Array(n); this.speedMul = new Float32Array(n);
    this.inTurn = new Uint8Array(n); this.u = new Float32Array(n); this.curve = new Float32Array(n * 6); this.curveL = new Float32Array(n);
    this.yaw = new Float32Array(n);
    this.nodeTurn = new Uint8Array(city.nodes.length); // 교차로 내 좌회전 차량 수
    for (let c = 0; c < n; c++) {
      const bus = c >= maxCars;
      const hwCar = c < this.hwCount;
      // 고속도로 차량은 강변 고가와 방사형에 반반 배치 (엣지 수 비례가 아니라 용량 기준)
      const pool = hwCar ? (rng() < 0.5 && hwElev.length ? hwElev : hwRadial.length ? hwRadial : hwEdges) : (bus || rng() < 0.75) && wideEdges.length ? wideEdges : roadEdges; // 대로에 차량 집중
      const e = pool[Math.floor(rng() * pool.length)];
      this.edge[c] = e.id; this.dir[c] = rng() < 0.5 ? 0 : 1;
      this.lane[c] = e.wide ? (bus ? 2 : Math.floor(rng() * 3)) : 0;
      this.laneFrom[c] = this.lane[c];
      this.t[c] = rng() * Math.max(1, e.length - this.hcEnd(c) - 10);
      this.speedMul[c] = bus ? 0.8 : 0.85 + 0.3 * rng();
      this.v[c] = this.maxSpeed(e.id, c) * 0.6;
      this.chooseNext(c);
      this.lat[c] = this.laneOffset(e.id, this.lane[c]);
      this.laneFrom[c] = this.lane[c];
    }
    this.carMesh = new THREE.InstancedMesh(carGeometry(), vehicleMaterial(U, 0.9, 2.15, 0.83), maxCars);
    this.busMesh = new THREE.InstancedMesh(busGeometry(), vehicleMaterial(U, 1.25, 5.5, 99), maxBuses);
    const color = new THREE.Color();
    for (let c = 0; c < maxCars; c++) { const k = CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)]; this.carMesh.setColorAt(c, color.setRGB(k[0], k[1], k[2])); }
    for (let c = 0; c < maxBuses; c++) { const k = BUS_COLORS[Math.floor(rng() * BUS_COLORS.length)]; this.busMesh.setColorAt(c, color.setRGB(k[0], k[1], k[2])); }
    for (const m of [this.carMesh, this.busMesh]) {
      m.frustumCulled = false; m.castShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const a = m.instanceMatrix.array;
      for (let i = 0; i < m.count; i++) { const o = i * 16; a[o + 5] = 1; a[o + 15] = 1; }
    }
  }

  maxSpeed(eid, c) {
    const bus = c >= this.maxCars;
    // 고속도로 제한속도 90 km/h (25 m/s), 차량별 편차는 ±8% 로 축소
    if (this.eHighway[eid]) { const mul = 0.92 + (this.speedMul[c] - 0.85) * (0.16 / 0.3); return (bus ? 22 : 25) * mul; }
    const v = this.eRamp[eid] ? 12 : this.eWide[eid] ? 16.5 : 9;
    return v * this.speedMul[c] * this.speedFac;
  }
  laneOffset(eid, lane) { return this.eWide[eid] ? 2.5 + 5 * lane : 3.0; }
  hcEnd(c) { const eid = this.edge[c]; return this.dir[c] ? this.eHcA[eid] : this.eHcB[eid]; }
  // 주행 방향 벡터 (dx, dz) 와 시작점
  frame(eid, d) {
    return this.roadFrames[eid][d];
  }
  yAt(eid, d, t) {
    if (this.eBridge[eid]) return CAR_Y + bridgeY(this.eLen[eid], Math.min(this.eLen[eid], Math.max(0, t)));
    const ya = d ? this.eYb[eid] : this.eYa[eid], yb = d ? this.eYa[eid] : this.eYb[eid];
    return CAR_Y + ya + (yb - ya) * Math.min(1, Math.max(0, t / this.eLen[eid]));
  }

  positionOf(c, out) {
    if (this.inTurn[c]) { const s = Math.min(1, this.u[c] / this.curveL[c]); this.bezier(c, s, out); return 0; }
    const [sx, sz, dx, dz] = this.frame(this.edge[c], this.dir[c]);
    out.set(sx + dx * this.t[c] - dz * this.lat[c], this.yAt(this.edge[c], this.dir[c], this.t[c]), sz + dz * this.t[c] + dx * this.lat[c]);
    return 0;
  }
  bezier(c, s, out) {
    const o = c * 6, cv = this.curve, m = 1 - s;
    out.set(m * m * cv[o] + 2 * s * m * cv[o + 2] + s * s * cv[o + 4], this.yAt(this.edge[c], this.dir[c], this.eLen[this.edge[c]]), m * m * cv[o + 1] + 2 * s * m * cv[o + 3] + s * s * cv[o + 5]);
    return out;
  }

  setDensity(density, hwDensity = density) {
    if (density === this.lastDensity && hwDensity === this.lastHwDensity) return;
    this.lastDensity = density; this.lastHwDensity = hwDensity;
    const normalMax = this.maxCars - this.hwCount;
    this.activeHw = Math.round(this.hwCount * hwDensity);
    this.activeNormal = Math.max(200, Math.round(normalMax * density));
    this.activeCars = this.hwCount + this.activeNormal; // 렌더 범위 (비활성 고속도로 차량은 숨김)
    this.activeBuses = Math.max(50, Math.round(this.maxBuses * (0.5 + 0.5 * density)));
    this.carMesh.count = this.activeCars; this.busMesh.count = this.activeBuses;
    this.speedFac = speedFactor(density);
  }
  get activeCount() { return this.activeHw + (this.activeNormal ?? this.maxCars - this.hwCount) + this.activeBuses; }
  get highwayCount() { return this.activeHw; }

  // 현재 엣지 끝 노드에서의 다음 진로 예약 + 회전 종류에 따른 목표 차선
  chooseNext(c) {
    const e = this.edges[this.edge[c]];
    const isBus = c >= this.maxCars;
    const node = this.dir[c] ? e.a : e.b;
    // Topology and routing weights are immutable. Cache each incoming edge,
    // direction and vehicle class without changing candidate or RNG order.
    const key = e.id * 6 + this.dir[c] * 3 + (c < this.hwCount ? 2 : Number(isBus));
    let choices = this.routeChoices[key];
    if (!choices) {
      let cands = node.edges.filter((x) => x !== e && !x.path && (!x.oneWay || x.a === node) && (!isBus || x.wide || node.edges.length <= 2));
      if (c < this.hwCount) {
        cands = cands.filter((x) => { if (!x.highway) return false; const far = x.a === node ? x.b : x.a; return far.poly || far.edges.some((y) => y.highway && y !== x); });
      }
      let total = 0;
      const weights = cands.map((x) => { let w = x.axis === e.axis ? 3 : 1; w *= x.ramp ? 0.9 : x.wide ? 3.5 : e.wide ? 0.3 : 0.7; total += w; return w; });
      choices = this.routeChoices[key] = { cands, weights, total };
    }
    const { cands, weights: w, total } = choices;
    let next, nd;
    if (!cands.length) { next = e; nd = this.dir[c] ^ 1; }
    else {
      let r = this.rng() * total, pick = 0;
      for (; pick < cands.length - 1; pick++) { r -= w[pick]; if (r <= 0) break; }
      next = cands[pick];
      nd = next.a === node ? 0 : 1;
    }
    this.nextEdge[c] = next.id; this.nextDir[c] = nd;
    const [, , dx, dz] = this.frame(e.id, this.dir[c]);
    const [, , d2x, d2z] = this.frame(next.id, nd);
    const cross = dx * d2z - dz * d2x, dot = dx * d2x + dz * d2z; // cross > 0 우회전
    const turn = next === e ? 2 : dot > 0.7 ? 0 : cross > 0 ? 1 : 2;
    this.turn[c] = turn;
    // 현재 엣지 목표 차선: 좌회전/유턴 1차선, 우회전 바깥 차선, 직진 임의 (횡방향 보간으로 이동)
    this.laneFrom[c] = this.lane[c];
    if (e.highway) { /* 고속도로: 차선 유지 (끝 유턴에서도 같은 차선 번호로) */ }
    else if (e.wide) this.lane[c] = isBus ? 2 : turn === 2 ? 0 : turn === 1 ? 2 : this.lane[c]; // 직진은 차선 유지
    else this.lane[c] = 0;
    if (next.highway) this.nextLane[c] = e.highway ? this.lane[c] : (isBus ? 2 : Math.floor(this.rng() * 3));
    else this.nextLane[c] = next.wide ? (isBus ? 2 : turn === 2 ? 0 : turn === 1 ? 2 : Math.min(this.lane[c], 2)) : 0;
  }

  // 교차로 진입: 회전 곡선 생성 (현재 차선 끝점 → 다음 엣지 차선 시작점)
  beginTurn(c) {
    const eid = this.edge[c], ne = this.nextEdge[c];
    const e = this.edges[eid];
    const node = this.dir[c] ? e.a : e.b;
    const [, , dx, dz] = this.frame(eid, this.dir[c]);
    const [, , d2x, d2z] = this.frame(ne, this.nextDir[c]);
    const hc = this.hcEnd(c);
    const hc2 = this.nextDir[c] ? this.eHcB[ne] : this.eHcA[ne];
    const rx = -dz, rz = dx, r2x = -d2z, r2z = d2x;
    const lat = this.lat[c], off2 = this.laneOffset(ne, this.nextLane[c]);
    const p0x = node.x - dx * hc + rx * lat, p0z = node.z - dz * hc + rz * lat;
    const p1x = node.x + d2x * hc2 + r2x * off2, p1z = node.z + d2z * hc2 + r2z * off2;
    let cx, cz;
    const turn = this.turn[c];
    if (turn === 0) { cx = (p0x + p1x) / 2; cz = (p0z + p1z) / 2; }
    else if (ne === eid) { cx = (p0x + p1x) / 2 + dx * hc * 1.4; cz = (p0z + p1z) / 2 + dz * hc * 1.4; }
    else {
      const den = dx * d2z - dz * d2x;
      if (Math.abs(den) < 0.05) { cx = (p0x + p1x) / 2; cz = (p0z + p1z) / 2; }
      else { const k = ((p1x - p0x) * d2z - (p1z - p0z) * d2x) / den; cx = p0x + dx * k; cz = p0z + dz * k; }
    }
    const o = c * 6, cv = this.curve;
    cv[o] = p0x; cv[o + 1] = p0z; cv[o + 2] = cx; cv[o + 3] = cz; cv[o + 4] = p1x; cv[o + 5] = p1z;
    // 곡선 길이 근사
    let L = 0, px = p0x, pz = p0z;
    for (let k = 1; k <= 8; k++) {
      const s = k / 8, m = 1 - s;
      const x = m * m * p0x + 2 * s * m * cx + s * s * p1x, z = m * m * p0z + 2 * s * m * cz + s * s * p1z;
      L += Math.hypot(x - px, z - pz); px = x; pz = z;
    }
    this.curveL[c] = Math.max(1, L);
    this.inTurn[c] = 1;
  }

  buildOccupancy() {
    const { grid, maxCars, inTurn, dir, eAid, eBid, edge, nextEdge, eCells, laneBase,
      nextDir, nextLane, u, curveL, v, t, lane, laneFrom } = this;
    const ranges = this.activeRanges;
    const cellRear = this.cellRear, cellV = this.cellV;
    const put = (idx, rear, speed, mark) => {
      if (!grid[idx] || rear < cellRear[idx]) { cellRear[idx] = rear; cellV[idx] = speed; }
      grid[idx] = grid[idx] === 2 ? 2 : mark;
    };
    // 1) 차선 점유 격자
    grid.fill(0); this.nodeTurn.fill(0);
    for (const [s0, s1] of ranges) {
      for (let c = s0; c < s1; c++) {
        const half = c >= maxCars ? 5.5 : 2.2;
        const mark = v[c] < 0.4 ? 2 : 1;
        if (inTurn[c]) {
          if (this.turn[c] === 2) { const nid = dir[c] ? eAid[edge[c]] : eBid[edge[c]]; this.nodeTurn[nid]++; }
          const ne = nextEdge[c];
          const cells = eCells[ne];
          const base = laneBase[ne * 6 + nextDir[c] * 3 + nextLane[c]];
          const hc2 = nextDir[c] ? this.eHcB[ne] : this.eHcA[ne];
          const prog = (u[c] / curveL[c]) * hc2;
          const c1 = Math.min(cells - 1, Math.floor((prog + half) / CELL));
          for (let k = 0; k <= c1; k++) put(base + k, prog - half, v[c], mark);
        } else {
          const eid = edge[c];
          const cells = eCells[eid];
          const c0 = Math.max(0, Math.floor((t[c] - half) / CELL)), c1 = Math.min(cells - 1, Math.floor((t[c] + half) / CELL));
          const base = laneBase[eid * 6 + dir[c] * 3 + lane[c]];
          for (let k = c0; k <= c1; k++) put(base + k, t[c] - half, v[c], mark);
          if (laneFrom[c] !== lane[c]) { const b2 = laneBase[eid * 6 + dir[c] * 3 + laneFrom[c]]; for (let k = c0; k <= c1; k++) put(b2 + k, t[c] - half, v[c], mark); }
        }
      }
    }
  }

  update(dt, time, nodeCross) {
    const { t, v, edge, dir, lane, laneFrom, lat, eLen, maxCars, grid, eCells, laneBase, eAxis, eAid, eBid, nextEdge, nextDir, nextLane, inTurn, u, curveL } = this;
    const nState = this.signals.nState, nSignal = this.signals.nSignal;
    const ranges = this.activeRanges;
    ranges[0][1] = this.activeHw; ranges[1][1] = this.activeCars; ranges[2][1] = maxCars + this.activeBuses;
    // 비활성 고속도로 차량은 지하 깊이 내려 숨김 (스케일 0 행렬은 법선 계산이 NaN 이 되어 블룸을 타고 화면 전체를 검게 만든다)
    { const a = this.carMesh.instanceMatrix.array; for (let c = this.activeHw; c < this.renderedActiveHw; c++) { const o = c * 16; a[o] = 1; a[o + 5] = 1; a[o + 10] = 1; a[o + 13] = -400; } }
    this.renderedActiveHw = this.activeHw;
    this.buildOccupancy();
    // 2) 주행
    const carArr = this.carMesh.instanceMatrix.array, busArr = this.busMesh.instanceMatrix.array;
    const pos = this.turnPosition;
    for (const [s0, s1] of ranges) {
      for (let c = s0; c < s1; c++) {
        const isBus = c >= maxCars;
        const half = isBus ? 5.5 : 2.2;
        let eid = edge[c];
        let vd = this.maxSpeed(eid, c);
        let px, pz, yaw;
        if (!inTurn[c]) {
          const cells = eCells[eid];
          const base = laneBase[eid * 6 + dir[c] * 3 + lane[c]];
          const frontCell = Math.min(cells - 1, Math.floor((t[c] + half) / CELL));
          const ne = nextEdge[c];
          const ncells = eCells[ne];
          const nbase = laneBase[ne * 6 + nextDir[c] * 3 + nextLane[c]];
          // 앞차 탐색: 정지거리(v²/2a)에 맞춰 늘린다. 앞차의 꼬리 위치·속도로 IDM 가속도 계산
          const look = 4 + Math.ceil((v[c] * v[c]) / (2 * 6 * CELL));
          let gap = -1, lv = 0;
          const front = t[c] + half;
          for (let k = 1; k <= look; k++) {
            const ci = frontCell + k;
            if (ci < cells) { if (grid[base + ci]) { gap = this.cellRear[base + ci] - front; lv = this.cellV[base + ci]; break; } }
            else if (ne !== eid && ci - cells < ncells) { const j = nbase + ci - cells; if (grid[j]) { gap = (eLen[eid] - front) + this.cellRear[j]; lv = this.cellV[j]; break; } }
            else break;
          }
          this.accFollow = gap >= 0 ? idmAccel(v[c], vd, Math.max(0.5, gap), v[c] - lv) : idmAccel(v[c], vd, 1e6, 0);
          const hc = this.hcEnd(c);
          const tEntry = eLen[eid] - hc;
          const tStop = tEntry - 5.0 - half;
          if (t[c] < tStop) {
            const endId = dir[c] ? eAid[eid] : eBid[eid];
            const turn = this.turn[c], ax = eAxis[eid];
            let mustStop = nSignal[endId] && !vehicleAllowed(nState[endId], ax, turn);
            if (!mustStop && (nodeCross[endId * 2 + ax] || (turn !== 0 && nodeCross[endId * 2 + 1 - ax]))) mustStop = true;
            if (!mustStop && turn === 2 && nSignal[endId] && this.nodeTurn[endId] > 0) mustStop = true; // 좌회전은 교차로당 한 대씩 (경로 교차 방지)
            if (!mustStop && ne !== eid && (grid[nbase] === 2 || grid[nbase + 1] === 2 || grid[nbase + 2] === 2)) mustStop = true;
            if (mustStop) vd = Math.min(vd, Math.max(0, (tStop - t[c] - 0.3) * 1.6));
          }
          if (this.turn[c] !== 0 && t[c] > tStop - 30) vd = Math.min(vd, this.eHighway[eid] ? 15 : 8); // 회전 전 감속
          {
            const vSig = v[c] + Math.max(-9 * dt, Math.min(3.5 * dt, vd - v[c]));          // 신호·정지선 제한
            const vIdm = v[c] + Math.max(-9 * dt, Math.min(IDM_A * dt, this.accFollow * dt)); // 앞차 추종
            v[c] = Math.max(0, Math.min(vSig, vIdm));
          }
          t[c] += v[c] * dt;
          // 차선 변경: 조향으로 전진하면서 옮겨간다 (정지 중에는 횡이동 없음)
          const target = this.laneOffset(eid, lane[c]);
          this.dlat = 0;
          if (lat[c] !== target) {
            const d = target - lat[c], maxStep = v[c] * dt * LANE_TAN;
            const step = Math.max(-maxStep, Math.min(maxStep, d));
            lat[c] += step; this.dlat = step;
            if (Math.abs(target - lat[c]) < 0.02) { lat[c] = target; laneFrom[c] = lane[c]; }
          }
          if (t[c] >= tEntry) { this.beginTurn(c); u[c] = t[c] - tEntry; if (this.turn[c] === 2) this.nodeTurn[dir[c] ? eAid[eid] : eBid[eid]]++; }
        }
        if (inTurn[c]) {
          // 회전 중: 다음 엣지 차선의 앞 칸 점유 검사
          const ne = nextEdge[c];
          const ncells = eCells[ne];
          const nbase = laneBase[ne * 6 + nextDir[c] * 3 + nextLane[c]];
          const hc2 = nextDir[c] ? this.eHcB[ne] : this.eHcA[ne];
          const prog = (u[c] / curveL[c]) * hc2;
          const myCell = Math.min(ncells - 1, Math.floor((prog + half) / CELL));
          const look = 4 + Math.ceil((v[c] * v[c]) / (2 * 6 * CELL));
          vd = this.turn[c] === 0 ? vd : Math.min(vd, this.eHighway[edge[c]] ? 15 : 8);
          let gap = -1, lv = 0;
          for (let k = 1; k <= look; k++) { const ci = myCell + k; if (ci >= ncells) break; if (grid[nbase + ci]) { gap = this.cellRear[nbase + ci] - (prog + half); lv = this.cellV[nbase + ci]; break; } }
          const acc = gap >= 0 ? idmAccel(v[c], vd, Math.max(0.5, gap), v[c] - lv) : idmAccel(v[c], vd, 1e6, 0);
          v[c] = Math.max(0, v[c] + Math.max(-9 * dt, Math.min(IDM_A * dt, acc * dt)));
          u[c] += v[c] * dt;
          if (u[c] >= curveL[c]) {
            // 다음 엣지로 진입
            const over = u[c] - curveL[c];
            edge[c] = ne; dir[c] = nextDir[c]; lane[c] = nextLane[c]; laneFrom[c] = lane[c];
            lat[c] = this.laneOffset(ne, lane[c]);
            t[c] = hc2 + over; inTurn[c] = 0;
            this.chooseNext(c);
            eid = ne;
            const [sx, sz, dx, dz] = this.frame(eid, dir[c]);
            px = sx + dx * t[c] - dz * lat[c]; pz = sz + dz * t[c] + dx * lat[c];
            yaw = Math.atan2(dx, dz);
          } else {
            const s = u[c] / curveL[c];
            this.bezier(c, s, pos);
            px = pos.x; pz = pos.z;
            const o = c * 6, cv = this.curve, m = 1 - s;
            const tx = 2 * m * (cv[o + 2] - cv[o]) + 2 * s * (cv[o + 4] - cv[o + 2]);
            const tz = 2 * m * (cv[o + 3] - cv[o + 1]) + 2 * s * (cv[o + 5] - cv[o + 3]);
            yaw = Math.atan2(tx, tz);
          }
        } else {
          const [sx, sz, dx, dz] = this.frame(eid, dir[c]);
          px = sx + dx * t[c] - dz * lat[c]; pz = sz + dz * t[c] + dx * lat[c];
          // 헤딩 = 실제 이동 방향 (전진 + 횡이동)
          const fwd = Math.max(v[c] * dt, 1e-4), sl = this.dlat / fwd;
          yaw = Math.atan2(dx - dz * sl, dz + dx * sl);
        }
        // 부드러운 헤딩 보간
        let y0 = this.yaw[c], dy = yaw - y0;
        if (dy > Math.PI) dy -= 2 * Math.PI; else if (dy < -Math.PI) dy += 2 * Math.PI;
        y0 += Math.max(-4.0 * dt, Math.min(4.0 * dt, dy));
        if (Math.abs(dy) > 2.5) y0 = yaw;
        this.yaw[c] = y0;
        const cs = Math.cos(y0), sn = Math.sin(y0);
        const a = isBus ? busArr : carArr;
        const o = (isBus ? c - maxCars : c) * 16;
        a[o] = cs; a[o + 2] = -sn; a[o + 8] = sn; a[o + 10] = cs; a[o + 5] = 1.0;
        a[o + 12] = px; a[o + 13] = inTurn[c] ? this.yAt(edge[c], dir[c], eLen[edge[c]]) : this.yAt(eid, dir[c], t[c]); a[o + 14] = pz;
      }
    }
    this.carMesh.instanceMatrix.addUpdateRange(0, this.activeCars * 16);
    this.busMesh.instanceMatrix.addUpdateRange(0, this.activeBuses * 16);
    this.carMesh.instanceMatrix.needsUpdate = true;
    this.busMesh.instanceMatrix.needsUpdate = true;
  }

  pick(ray, camPos) {
    const p = new THREE.Vector3();
    let best = -1, bestD = Infinity;
    const ranges = [[0, this.activeHw], [this.hwCount, this.activeCars], [this.maxCars, this.maxCars + this.activeBuses]];
    for (const [s0, s1] of ranges) {
      for (let c = s0; c < s1; c++) {
        this.positionOf(c, p);
        const d2 = ray.distanceSqToPoint(p);
        const tol = Math.max(2.5, camPos.distanceTo(p) * 0.006);
        if (d2 < tol * tol && d2 < bestD) { bestD = d2; best = c; }
      }
    }
    return best;
  }
}
