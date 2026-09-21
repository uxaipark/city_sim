// 보행자 (대규모)
//  - 인도(도로 옆) / 공원 산책로를 따라 이동, 카메라 주변만 시뮬레이션
//  - 횡단보도: 보행 초록일 때만 출발(빨강·점멸엔 절대 출발 금지), 횡단 중 인원을 교차로별로 집계해 차량이 양보
//  - 진로 전환(직진/모서리 회전/유턴)은 위치가 끊기지 않게 처리, 횡방향 오프셋은 보간
import * as THREE from 'three';
import { SLAB_H, bridgeY } from './citygen.js';
import { mulberry32 } from './noise.js';
import { pedAllowed } from './signals.js';

const CLOTHES = [
  [0.85, 0.2, 0.2], [0.2, 0.3, 0.7], [0.9, 0.9, 0.9], [0.15, 0.15, 0.18], [0.9, 0.7, 0.2], [0.3, 0.6, 0.35],
  [0.6, 0.4, 0.7], [0.95, 0.55, 0.3], [0.4, 0.45, 0.5], [0.75, 0.6, 0.5],
];
const DETAIL_R = 2000;
const CROSS_SPEED = 1.9;
const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

export class People {
  constructor(city, U, signals, max = 180000) {
    this.edges = city.edges; this.signals = signals; this.max = max; this.active = max;
    const rng = mulberry32(555);
    this.rng = rng;
    const E = city.edges.length;
    this.eAx = new Float32Array(E); this.eAz = new Float32Array(E); this.eBx = new Float32Array(E); this.eBz = new Float32Array(E); this.eLen = new Float32Array(E);
    this.eAid = new Int32Array(E); this.eBid = new Int32Array(E); this.eAxis = new Uint8Array(E);
    this.eDx = new Float32Array(E); this.eDz = new Float32Array(E); this.eBridge = new Uint8Array(E);
    this.eHcA = new Float32Array(E); this.eHcB = new Float32Array(E); // 끝 노드에서 건너야 할 교차 도로 반폭
    for (const e of city.edges) {
      const id = e.id;
      this.eAx[id] = e.a.x; this.eAz[id] = e.a.z; this.eBx[id] = e.b.x; this.eBz[id] = e.b.z; this.eLen[id] = e.length;
      this.eAid[id] = e.a.id; this.eBid[id] = e.b.id; this.eAxis[id] = e.axis;
      this.eDx[id] = (e.b.x - e.a.x) / e.length; this.eDz[id] = (e.b.z - e.a.z) / e.length; this.eBridge[id] = e.bridge ? 1 : 0;
      this.eHcA[id] = (e.axis === 0 ? e.a.wv : e.a.wh) / 2; this.eHcB[id] = (e.axis === 0 ? e.b.wv : e.b.wh) / 2;
    }
    this.nodeCross = new Uint16Array(city.nodes.length * 2);
    const walkable = city.edges.filter((e) => !e.highway && !e.ramp);
    this.edge = new Int32Array(max); this.dir = new Uint8Array(max); this.t = new Float32Array(max);
    this.off = new Float32Array(max); this.offT = new Float32Array(max); this.speed = new Float32Array(max);
    this.nextEdge = new Int32Array(max); this.nextDir = new Uint8Array(max); this.nextOff = new Float32Array(max);
    this.kind = new Uint8Array(max); // 0 직진, 1 모서리 회전, 2 유턴
    this.crossing = new Uint8Array(max); this.crossNode = new Int32Array(max); this.crossAxis = new Uint8Array(max); this.crossEndT = new Float32Array(max);
    for (let c = 0; c < max; c++) {
      const e = walkable[Math.floor(rng() * walkable.length)];
      this.edge[c] = e.id; this.dir[c] = rng() < 0.5 ? 0 : 1;
      this.t[c] = rng() * Math.max(1, e.length - 20);
      this.off[c] = this.offT[c] = this.sideOffset(e, rng() < 0.5 ? -1 : 1);
      this.speed[c] = 1.0 + rng() * 0.8;
      this.chooseNext(c);
    }
    const geo = new THREE.CapsuleGeometry(0.24, 1.15, 1, 6);
    geo.translate(0, 0.82, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    mat.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vH;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = position.y;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vH;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.65, 0.5), smoothstep(1.28, 1.34, vH));`);
    };
    mat.customProgramCacheKey = () => 'people';
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const color = new THREE.Color();
    for (let c = 0; c < max; c++) { const k = CLOTHES[Math.floor(rng() * CLOTHES.length)]; this.mesh.setColorAt(c, color.setRGB(k[0], k[1], k[2])); }
    const a = this.mesh.instanceMatrix.array;
    for (let i = 0; i < max; i++) { const o = i * 16; a[o] = 1; a[o + 5] = 1; a[o + 10] = 1; a[o + 15] = 1; }
    this.writeAll();
  }

  // 엣지 종류별 횡방향 오프셋: 도로 = 인도, 격자 산책로 = 횡단보도 정렬, 내부 산책로 = 길 위
  sideOffset(e, side) {
    if (!e.path) return side * (e.width / 2 + 0.8 + this.rng() * 2.4);
    if (e.grid) return side * ((e.stubW || 4) / 2 + 0.8 + this.rng() * 2.4);
    if (e.grass) return (this.rng() - 0.5) * 8;
    return (this.rng() - 0.5) * 3;
  }

  // 다음 진로: 직진(교차 도로를 횡단보도로 건넘) 또는 자기 인도 쪽 모서리로 꺾기. 자기 도로를 무단횡단하지 않는다.
  chooseNext(c) {
    const e = this.edges[this.edge[c]];
    const node = this.dir[c] ? e.a : e.b, from = this.dir[c] ? e.b : e.a;
    const dx = sgn(node.x - from.x), dz = sgn(node.z - from.z);
    const rx = -dz, rz = dx, s = this.off[c] >= 0 ? 1 : -1;
    const cands = node.edges.filter((x) => x !== e && !x.highway && !x.ramp);
    let pool;
    if (node.park || (e.path && !e.grid)) pool = cands; // 공원 내부 노드: 제한 없음
    else pool = cands.filter((x) => {
      if (x.axis === e.axis) return true;
      const to = x.a === node ? x.b : x.a;
      return (sgn(to.x - node.x) * rx + sgn(to.z - node.z) * rz) * s > 0;
    });
    if (!pool.length) {
      this.nextEdge[c] = e.id; this.nextDir[c] = this.dir[c] ^ 1; this.nextOff[c] = -this.off[c]; this.kind[c] = 2;
      return;
    }
    const next = pool[Math.floor(this.rng() * pool.length)];
    const nd = next.a === node ? 0 : 1;
    this.nextEdge[c] = next.id; this.nextDir[c] = nd;
    if (next.axis === e.axis && next.axis !== 2) {
      this.nextOff[c] = this.sideOffset(next, s); this.kind[c] = 0;
    } else {
      const to = nd ? next.a : next.b;
      const d2x = sgn(to.x - node.x), d2z = sgn(to.z - node.z);
      const r2x = -d2z, r2z = d2x;
      const side2 = sgn(-dx * r2x - dz * r2z) || 1;
      this.nextOff[c] = this.sideOffset(next, side2); this.kind[c] = 1;
    }
  }

  setDensity(density) {
    this.active = Math.max(100, Math.round(this.max * density));
    this.mesh.count = this.active;
  }

  writePos(c, a) {
    const eid = this.edge[c], d = this.dir[c], f = d ? -1 : 1;
    const sx = d ? this.eBx[eid] : this.eAx[eid], sz = d ? this.eBz[eid] : this.eAz[eid];
    const dx = this.eDx[eid] * f, dz = this.eDz[eid] * f;
    const o = c * 16;
    const ty = d ? this.eLen[eid] - this.t[c] : this.t[c];
    a[o + 12] = sx + dx * this.t[c] - dz * this.off[c]; a[o + 13] = SLAB_H + (this.eBridge[eid] ? bridgeY(this.eLen[eid], Math.min(this.eLen[eid], Math.max(0, ty))) : 0); a[o + 14] = sz + dz * this.t[c] + dx * this.off[c];
  }
  writeAll() {
    const a = this.mesh.instanceMatrix.array;
    for (let c = 0; c < this.max; c++) this.writePos(c, a);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt, focus, simOnly = false) {
    const { edge, dir, t, off, offT, speed, eLen, eAx, eAz, eBx, eBz, eAid, eBid, eAxis, eHcA, eHcB, kind, crossing, nodeCross } = this;
    const nState = this.signals.nState, nSignal = this.signals.nSignal;
    const a = this.mesh.instanceMatrix.array;
    const fx = focus.x, fz = focus.z;
    nodeCross.fill(0);
    for (let c = 0; c < this.active; c++) {
      let eid = edge[c];
      const cx = (eAx[eid] + eBx[eid]) * 0.5, cz = (eAz[eid] + eBz[eid]) * 0.5;
      if (Math.abs(cx - fx) > DETAIL_R || Math.abs(cz - fz) > DETAIL_R) continue;
      const len = eLen[eid], d = dir[c];
      const endId = d ? eAid[eid] : eBid[eid];
      const hc = d ? eHcA[eid] : eHcB[eid];
      const tw = len - hc - 0.6; // 횡단 시작점 (교차 도로 가장자리)
      const k = kind[c];
      const tSwitch = k === 0 ? len : k === 1 ? Math.max(0, len - Math.abs(this.nextOff[c])) : tw; // 모서리: 새 인도 라인에서 꺾는다
      let sp = crossing[c] ? Math.max(speed[c], CROSS_SPEED) : speed[c];
      let nt = t[c] + sp * dt;
      // 횡단보도: 직진이면 교차 도로를 건너야 함 → 신호가 보행 초록일 때만 출발
      if (k === 0 && !crossing[c] && nSignal[endId] && t[c] <= tw + 0.01 && nt > tw - 0.001) {
        if (!pedAllowed(nState[endId], 1 - eAxis[eid])) nt = Math.min(nt, tw);
        else { crossing[c] = 1; this.crossNode[c] = endId; this.crossAxis[c] = 1 - eAxis[eid]; }
      }
      if (crossing[c]) {
        nodeCross[this.crossNode[c] * 2 + this.crossAxis[c]]++;
        if (t[c] >= this.crossEndT[c] && this.crossEndT[c] > 0) { crossing[c] = 0; this.crossEndT[c] = 0; }
      }
      t[c] = nt;
      // 횡방향 오프셋 보간
      if (off[c] !== offT[c]) { const dd = offT[c] - off[c]; const rate = this.edges[eid].path ? 2.6 : 1.2; off[c] += Math.max(-rate * dt, Math.min(rate * dt, dd)); }
      if (t[c] >= tSwitch) {
        const over = t[c] - tSwitch;
        const ne = this.nextEdge[c], nd = this.nextDir[c], no = this.nextOff[c];
        let t0;
        if (k === 0) { t0 = 0; offT[c] = no; }
        else if (k === 1) { t0 = Math.abs(off[c]); off[c] = no; offT[c] = no; } // 위치 연속: 옛 오프셋만큼 진행한 지점에서 시작
        else { t0 = len - tSwitch; off[c] = -off[c]; offT[c] = -offT[c]; }
        edge[c] = ne; dir[c] = nd; t[c] = t0 + over;
        if (crossing[c]) { const hc2 = nd ? eHcB[ne] : eHcA[ne]; this.crossEndT[c] = hc2 + 0.6; }
        this.chooseNext(c);
        eid = ne;
      }
      if (!simOnly) this.writePos(c, a);
    }
    if (!simOnly) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
