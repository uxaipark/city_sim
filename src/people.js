// 보행자 (대규모)
//  - 인도(도로 옆) / 공원 산책로를 따라 이동, 카메라 주변만 시뮬레이션
//  - 횡단보도: 보행 초록일 때만 출발(빨강·점멸엔 절대 출발 금지), 횡단 중 인원을 교차로별로 집계해 차량이 양보
//  - 진로 전환(직진/모서리 회전/유턴)은 위치가 끊기지 않게 처리, 횡방향 오프셋은 보간
import * as THREE from 'three';
import { SLAB_H, BRIDGE_H, bridgeY } from './citygen.js';
import { mulberry32 } from './noise.js';
import { pedAllowed } from './signals.js';
import { MemberBuckets } from './member-buckets.js';

const CLOTHES = [
  [0.85, 0.2, 0.2], [0.2, 0.3, 0.7], [0.9, 0.9, 0.9], [0.15, 0.15, 0.18], [0.9, 0.7, 0.2], [0.3, 0.6, 0.35],
  [0.6, 0.4, 0.7], [0.95, 0.55, 0.3], [0.4, 0.45, 0.5], [0.75, 0.6, 0.5],
];
const DETAIL_R = 2000;
const RENDER_CELL = 512;
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
    this.nearEdge = new Uint8Array(E);
    this.focusX = NaN; this.focusZ = NaN;
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
    this.edgeMembers = new MemberBuckets(E, max);
    this.nearPeople = new Uint32Array(Math.ceil(max / 32));
    for (let c = 0; c < max; c++) this.edgeMembers.move(c, this.edge[c]);
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
    // Keep simulation positions separate from the compact, visible GPU stream.
    this.positions = this.mesh.instanceMatrix.array;
    this.colors = this.mesh.instanceColor.array;
    this.mesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(max * 16), 16).setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.renderIds = new Int32Array(max).fill(-1);
    this.frustum = new THREE.Frustum();
    this.viewProjection = new THREE.Matrix4();
    this.bounds = new THREE.Sphere(new THREE.Vector3(), 1.5);
    // Index the stored render positions, not the simulated edge: simOnly deliberately
    // leaves distant render positions unchanged, exactly as the original implementation.
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const e of walkable) {
      minX = Math.min(minX, e.a.x, e.b.x); minZ = Math.min(minZ, e.a.z, e.b.z);
      maxX = Math.max(maxX, e.a.x, e.b.x); maxZ = Math.max(maxZ, e.a.z, e.b.z);
    }
    this.renderOriginX = Math.floor((minX - 128) / RENDER_CELL) * RENDER_CELL;
    this.renderOriginZ = Math.floor((minZ - 128) / RENDER_CELL) * RENDER_CELL;
    this.renderCols = Math.ceil((maxX + 128 - this.renderOriginX) / RENDER_CELL);
    this.renderRows = Math.ceil((maxZ + 128 - this.renderOriginZ) / RENDER_CELL);
    this.renderMembers = new MemberBuckets(this.renderCols * this.renderRows, max);
    this.renderBoxes = Array.from({ length: this.renderMembers.head.length }, (_, cell) => {
      const x = this.renderOriginX + (cell % this.renderCols) * RENDER_CELL;
      const z = this.renderOriginZ + Math.floor(cell / this.renderCols) * RENDER_CELL;
      const r = this.bounds.radius;
      return new THREE.Box3(new THREE.Vector3(x - r, SLAB_H + 0.82 - r, z - r),
        new THREE.Vector3(x + RENDER_CELL + r, SLAB_H + BRIDGE_H + 0.82 + r, z + RENDER_CELL + r));
    });
    this.visibleCells = new Int32Array(this.renderMembers.head.length);
    this.visiblePeople = new Uint32Array(Math.ceil(max / 32));
    for (let c = 0; c < max; c++) this.indexRenderPosition(c);
    this.lastSimCandidates = this.lastRenderCandidates = 0;
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
    if (this.renderMembers) this.indexRenderPosition(c);
  }
  writeAll() {
    const a = this.positions || this.mesh.instanceMatrix.array;
    for (let c = 0; c < this.max; c++) this.writePos(c, a);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt, focus, simOnly = false) {
    const { edge, dir, t, off, offT, speed, eLen, eAx, eAz, eBx, eBz, eAid, eBid, eAxis, eHcA, eHcB, kind, crossing, nodeCross } = this;
    const nState = this.signals.nState, nSignal = this.signals.nSignal;
    const a = this.positions;
    const fx = focus.x, fz = focus.z;
    if (fx !== this.focusX || fz !== this.focusZ) {
      for (let eid = 0; eid < eLen.length; eid++) {
        const near = Math.abs((eAx[eid] + eBx[eid]) * 0.5 - fx) <= DETAIL_R &&
          Math.abs((eAz[eid] + eBz[eid]) * 0.5 - fz) <= DETAIL_R ? 1 : 0;
        if (near === this.nearEdge[eid]) continue;
        this.nearEdge[eid] = near;
        for (let c = this.edgeMembers.head[eid]; c !== -1; c = this.edgeMembers.next[c]) {
          const bit = 1 << (c & 31);
          if (near) this.nearPeople[c >>> 5] |= bit;
          else this.nearPeople[c >>> 5] &= ~bit;
        }
      }
      this.focusX = fx; this.focusZ = fz;
    }
    nodeCross.fill(0);
    this.lastSimCandidates = 0;
    // Visit candidates in ascending person ID to preserve the shared RNG sequence.
    for (let wi = 0; wi < Math.ceil(this.active / 32); wi++) {
      let word = this.nearPeople[wi];
      while (word) {
      const bit = word & -word; word ^= bit;
      const c = wi * 32 + 31 - Math.clz32(bit);
      if (c >= this.active) break;
      this.lastSimCandidates++;
      let eid = edge[c];
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
        this.edgeMembers.move(c, ne);
        if (this.nearEdge[ne]) this.nearPeople[c >>> 5] |= 1 << (c & 31);
        else this.nearPeople[c >>> 5] &= ~(1 << (c & 31));
        if (crossing[c]) { const hc2 = nd ? eHcB[ne] : eHcA[ne]; this.crossEndT[c] = hc2 + 0.6; }
        this.chooseNext(c);
        eid = ne;
      }
      if (!simOnly) this.writePos(c, a);
      }
    }
  }

  indexRenderPosition(c) {
    const a = this.positions, o = c * 16;
    const x = a[o + 12], y = a[o + 13] + 0.82, z = a[o + 14];
    const previous = this.renderMembers.bucket[c];
    if (previous !== -1) {
      const box = this.renderBoxes[previous], r = this.bounds.radius;
      if (x >= box.min.x + r && x < box.max.x - r && z >= box.min.z + r && z < box.max.z - r &&
          y >= box.min.y + r && y <= box.max.y - r) return;
    }
    const ix = Math.max(0, Math.min(this.renderCols - 1, Math.floor((x - this.renderOriginX) / RENDER_CELL)));
    const iz = Math.max(0, Math.min(this.renderRows - 1, Math.floor((z - this.renderOriginZ) / RENDER_CELL)));
    const cell = iz * this.renderCols + ix;
    this.renderMembers.move(c, cell);
    // Normally the fixed cell bounds already contain the complete walking height.
    // Expand conservatively if an exceptional position lies beyond the world grid.
    const box = this.renderBoxes[cell], r = this.bounds.radius;
    box.min.x = Math.min(box.min.x, x - r); box.max.x = Math.max(box.max.x, x + r);
    box.min.y = Math.min(box.min.y, y - r); box.max.y = Math.max(box.max.y, y + r);
    box.min.z = Math.min(box.min.z, z - r); box.max.z = Math.max(box.max.z, z + r);
  }

  writeRenderInstance(c, index) {
    const a = this.positions, dst = index * 16, o = c * 16;
    const matrices = this.mesh.instanceMatrix.array;
    for (let k = 0; k < 16; k++) matrices[dst + k] = a[o + k];
    if (this.renderIds[index] === c) return false;
    this.renderIds[index] = c;
    const colors = this.mesh.instanceColor.array;
    for (let k = 0; k < 3; k++) colors[index * 3 + k] = this.colors[c * 3 + k];
    return true;
  }

  updateRender(camera) {
    if (!this.mesh.visible) return;
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    const matrices = this.mesh.instanceMatrix, colors = this.mesh.instanceColor;
    const a = this.positions, members = this.renderMembers;
    this.lastRenderCandidates = 0;
    let cellCount = 0, candidates = 0;
    for (let cell = 0; cell < members.head.length; cell++) {
      if (members.head[cell] === -1 || !this.frustum.intersectsBox(this.renderBoxes[cell])) continue;
      this.visibleCells[cellCount++] = cell; candidates += members.size[cell];
    }
    let count = 0, colorChanged = false;
    // Dense views are faster as a sequential scan than pointer-chasing through
    // most buckets. Sparse views use the index and preserve the same ID order.
    if (candidates > this.max * 0.25) {
      this.lastRenderCandidates = this.active;
      for (let c = 0; c < this.active; c++) {
        const o = c * 16;
        this.bounds.center.set(a[o + 12], a[o + 13] + 0.82, a[o + 14]);
        if (!this.frustum.intersectsSphere(this.bounds)) continue;
        colorChanged = this.writeRenderInstance(c, count++) || colorChanged;
      }
    } else {
      this.visiblePeople.fill(0);
      for (let i = 0; i < cellCount; i++) {
        for (let c = members.head[this.visibleCells[i]]; c !== -1; c = members.next[c]) {
          if (c >= this.active) continue;
          this.lastRenderCandidates++;
          const o = c * 16;
          this.bounds.center.set(a[o + 12], a[o + 13] + 0.82, a[o + 14]);
          if (this.frustum.intersectsSphere(this.bounds)) this.visiblePeople[c >>> 5] |= 1 << (c & 31);
        }
      }
      for (let wi = 0; wi < Math.ceil(this.active / 32); wi++) {
        let word = this.visiblePeople[wi];
        while (word) {
          const bit = word & -word; word ^= bit;
          const c = wi * 32 + 31 - Math.clz32(bit);
          colorChanged = this.writeRenderInstance(c, count++) || colorChanged;
        }
      }
    }
    this.mesh.count = count;
    if (count) {
      matrices.addUpdateRange(0, count * 16); matrices.needsUpdate = true;
      if (colorChanged) { colors.addUpdateRange(0, count * 3); colors.needsUpdate = true; }
    }
  }
}
