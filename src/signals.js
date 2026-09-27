// 신호등 체계
//  - 교차로 상태: 축별 직진 → 노랑 → 좌회전 화살표 → 노랑 (사이에 전적색)
//  - 진입로(횡단보도)마다 차량 신호등(4구: 빨강·노랑·좌회전·초록) 1개, 보행자 신호등(2구) 2개
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SLAB_H } from './citygen.js';
import { hash2 } from './noise.js';

export const CYCLE = 64; // 초
// 상태: 0 = x직진(보행 초록), 7 = x직진(보행 점멸), 2 = x노랑, 5 = x좌회전
//       1 = z직진(보행 초록), 8 = z직진(보행 점멸), 3 = z노랑, 6 = z좌회전, 4 = 전적색
export function signalState(ph) {
  // 전적색 구간을 넉넉히(약 3초) 두어 교차로가 비워진 뒤 교차 방향이 출발한다
  if (ph < 0.10) return 0;
  if (ph < 0.28) return 7;
  if (ph < 0.31) return 2;
  if (ph < 0.36) return 4;
  if (ph < 0.44) return 5;
  if (ph < 0.46) return 2;
  if (ph < 0.50) return 4;
  if (ph < 0.60) return 1;
  if (ph < 0.78) return 8;
  if (ph < 0.81) return 3;
  if (ph < 0.86) return 4;
  if (ph < 0.94) return 6;
  if (ph < 0.96) return 3;
  return 4;
}
// 차량 통행 허용: turn 0 직진, 1 우회전, 2 좌회전/유턴 (회전은 화살표 구간에만)
export function vehicleAllowed(state, axis, turn) {
  if (turn === 0) return state === axis || state === 7 + axis;
  return state === 5 + axis;
}
// 보행자 출발 허용: 도로 roadAxis 를 건너는 횡단보도는 다른 축의 "보행 초록" 상태에서만
export const pedAllowed = (state, roadAxis) => state === 1 - roadAxis;

const RED = [1.0, 0.08, 0.06], YEL = [1.0, 0.72, 0.08], GRN = [0.12, 0.95, 0.35], ARROW = [0.2, 0.9, 0.5];
const OFF = 0.08;
const ON = 2.6; // HDR 밝기 (블룸)
const UP = new THREE.Vector3(0, 1, 0);

export class Signals {
  constructor(city) {
    const nodes = city.nodes;
    this.nSignal = new Uint8Array(nodes.length);
    this.nPhase = new Float32Array(nodes.length);
    this.nState = new Uint8Array(nodes.length).fill(4);
    for (const n of nodes) { this.nSignal[n.id] = n.signal ? 1 : 0; this.nPhase[n.id] = hash2(n.i, n.j, 3); }

    const veh = [], ped = [];
    for (const n of nodes) {
      if (!n.signal) continue;
      for (const e of n.edges) {
        if (e.path) continue;
        const from = e.a === n ? e.b : e.a;
        const dx = Math.sign(n.x - from.x), dz = Math.sign(n.z - from.z); // 진입 방향
        const rx = -dz, rz = dx; // 진입 차량의 우측
        const crossW = e.axis === 0 ? n.wv : n.wh;
        const stopBack = crossW / 2 + 5.2, cwBack = crossW / 2 + 2.1, side = e.width / 2 + 1.0;
        veh.push({ x: n.x - dx * stopBack + rx * side, z: n.z - dz * stopBack + rz * side, yaw: Math.atan2(-rx, -rz), node: n.id, axis: e.axis });
        for (const s of [-1, 1]) {
          ped.push({ x: n.x - dx * cwBack + s * rx * side, z: n.z - dz * cwBack + s * rz * side, yaw: Math.atan2(-s * rx, -s * rz), node: n.id, axis: e.axis });
        }
      }
    }
    this.veh = veh; this.ped = ped;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const dark = new THREE.MeshStandardMaterial({ color: 0x25272b, roughness: 0.7, metalness: 0.4 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });

    // 차량 신호등: 기둥 + 암(도로 위로) + 4구 가로형 하우징. local +z = 암 방향(도로 안쪽), 등은 -x(진입 차량) 쪽을 향함
    const armLen = Math.min(6, 6);
    const pole = new THREE.CylinderGeometry(0.13, 0.16, 5.6, 8).toNonIndexed(); pole.translate(0, 2.8, 0);
    const arm = new THREE.BoxGeometry(0.16, 0.16, armLen).toNonIndexed(); arm.translate(0, 5.5, armLen / 2);
    const house = new THREE.BoxGeometry(0.45, 0.5, 1.7).toNonIndexed(); house.translate(0, 5.0, armLen - 1.0);
    this.vehPole = new THREE.InstancedMesh(mergeGeometries([pole, arm, house]), dark, veh.length);
    this.vehPole.castShadow = true;
    const lampZ = [armLen - 1.65, armLen - 1.25, armLen - 0.75, armLen - 0.35]; // 빨강, 노랑, 좌회전, 초록
    const lampGeo = new THREE.BoxGeometry(0.16, 0.34, 0.34); lampGeo.translate(-0.25, 5.0, 0);
    this.vehLamp = new THREE.InstancedMesh(lampGeo, lampMat, veh.length * 4);
    const arrowGeo = new THREE.ConeGeometry(0.1, 0.22, 3); arrowGeo.rotateZ(Math.PI / 2); arrowGeo.rotateY(Math.PI / 2); arrowGeo.translate(-0.36, 5.0, 0);
    this.vehArrow = new THREE.InstancedMesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0x0a2a14, toneMapped: false }), veh.length);
    const c = new THREE.Color();
    veh.forEach((l, k) => {
      q.setFromAxisAngle(UP, l.yaw); p.set(l.x, SLAB_H, l.z); m.compose(p, q, one);
      this.vehPole.setMatrixAt(k, m);
      for (let i = 0; i < 4; i++) {
        p.set(l.x, SLAB_H, l.z).addScaledVector(new THREE.Vector3(-Math.sin(l.yaw) * 0 + Math.sin(l.yaw), 0, Math.cos(l.yaw)).normalize(), lampZ[i]);
        m.compose(p, q, one);
        this.vehLamp.setMatrixAt(k * 4 + i, m);
        this.vehLamp.setColorAt(k * 4 + i, c.setRGB(OFF, OFF, OFF));
        if (i === 2) this.vehArrow.setMatrixAt(k, m);
      }
    });
    this.vehLamp.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // 보행자 신호등: 짧은 기둥 + 세로 2구. local +z = 건너는 방향
    const ppole = new THREE.CylinderGeometry(0.08, 0.1, 3.0, 6).toNonIndexed(); ppole.translate(0, 1.5, 0);
    const phouse = new THREE.BoxGeometry(0.36, 0.8, 0.3).toNonIndexed(); phouse.translate(0, 2.8, 0.12);
    this.pedPole = new THREE.InstancedMesh(mergeGeometries([ppole, phouse]), dark, ped.length);
    const plamp = new THREE.BoxGeometry(0.26, 0.28, 0.1);
    this.pedLamp = new THREE.InstancedMesh(plamp, lampMat, ped.length * 2);
    ped.forEach((l, k) => {
      q.setFromAxisAngle(UP, l.yaw); p.set(l.x, SLAB_H, l.z); m.compose(p, q, one);
      this.pedPole.setMatrixAt(k, m);
      for (let i = 0; i < 2; i++) { // 0 = 빨강(위), 1 = 초록(아래)
        p.set(l.x, SLAB_H + (i === 0 ? 3.0 : 2.62), l.z).addScaledVector(new THREE.Vector3(Math.sin(l.yaw), 0, Math.cos(l.yaw)), 0.3);
        m.compose(p, q, one);
        this.pedLamp.setMatrixAt(k * 2 + i, m);
        this.pedLamp.setColorAt(k * 2 + i, c.setRGB(OFF, OFF, OFF));
      }
    });
    this.pedLamp.instanceColor.setUsage(THREE.DynamicDrawUsage);

    this.group = new THREE.Group();
    this.group.add(this.vehPole, this.vehLamp, this.vehArrow, this.pedPole, this.pedLamp);
    this.count = veh.length + ped.length;
    this.vehState = new Int8Array(veh.length).fill(-1);
    this.pedState = new Int8Array(ped.length).fill(-1);
  }

  update(time) {
    const { nState, nPhase, nSignal } = this;
    for (let i = 0; i < nState.length; i++) if (nSignal[i]) nState[i] = signalState((time / CYCLE + nPhase[i]) % 1);
    const set = (arr, k, col, on) => { const f = on ? ON : OFF; arr[k * 3] = col[0] * f; arr[k * 3 + 1] = col[1] * f; arr[k * 3 + 2] = col[2] * f; };
    const vc = this.vehLamp.instanceColor.array;
    let vehicleChanged = false, pedestrianChanged = false;
    for (let k = 0; k < this.veh.length; k++) {
      const l = this.veh[k], st = nState[l.node], ax = l.axis;
      if (this.vehState[k] === st) continue;
      this.vehState[k] = st;
      vehicleChanged = true;
      this.vehLamp.instanceColor.addUpdateRange(k * 12, 12);
      const green = st === ax || st === 7 + ax, yellow = st === ax + 2, left = st === 5 + ax;
      set(vc, k * 4, RED, !green && !yellow && !left);
      set(vc, k * 4 + 1, YEL, yellow);
      set(vc, k * 4 + 2, ARROW, left);
      set(vc, k * 4 + 3, GRN, green);
    }
    if (vehicleChanged) this.vehLamp.instanceColor.needsUpdate = true;
    const pc = this.pedLamp.instanceColor.array;
    const blink = (time % 0.6) < 0.3;
    for (let k = 0; k < this.ped.length; k++) {
      const l = this.ped[k], st = nState[l.node];
      const walk = pedAllowed(st, l.axis);
      const ending = st === 7 + (1 - l.axis); // 보행 점멸 (새로 건너기 금지)
      const display = (walk ? 1 : 0) | (ending ? 2 : 0) | (ending && blink ? 4 : 0);
      if (this.pedState[k] === display) continue;
      this.pedState[k] = display;
      pedestrianChanged = true;
      this.pedLamp.instanceColor.addUpdateRange(k * 6, 6);
      set(pc, k * 2, RED, !walk && !ending);
      set(pc, k * 2 + 1, GRN, walk || (ending && blink));
    }
    if (pedestrianChanged) this.pedLamp.instanceColor.needsUpdate = true;
  }
}
