// 지하철: 노선 리본, 열차 운행, 지상 역 출입구, X-ray 토글
import * as THREE from 'three';
import { roadWidth, SLAB_H } from './citygen.js';

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

export class Subway {
  constructor(city) {
    this.group = new THREE.Group();
    this.xray = new THREE.Group();
    this.group.add(this.xray);
    this.trains = [];
    this.lines = city.subwayLines;
    const trainGeo = new THREE.BoxGeometry(7, 3.4, 60);
    trainGeo.translate(0, 1.7, 0);
    let totalTrains = 0;
    for (const line of this.lines) {
      const pts = line.nodes.map((n) => new THREE.Vector3(n.x, -12, n.z));
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + pts[k].distanceTo(pts[k - 1]));
      line.pts = pts; line.cum = cum; line.total = cum[cum.length - 1];
      line.stationS = line.stations.map((s) => cum[line.nodes.indexOf(s)]);
      // 노선 리본
      const w = 14, pos = [], idx = [];
      for (let k = 0; k < pts.length; k++) {
        const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
        const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1;
        const nx = -tz / tl, nz = tx / tl;
        pos.push(pts[k].x - nx * w, 1.0, pts[k].z - nz * w, pts[k].x + nx * w, 1.0, pts[k].z + nz * w);
        if (k > 0) { const v = k * 2; idx.push(v - 2, v, v - 1, v - 1, v, v + 1); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      const ribbon = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: line.color, transparent: true, opacity: 0.8, depthTest: false, side: THREE.DoubleSide }));
      ribbon.renderOrder = 20;
      this.xray.add(ribbon);
      // 역 마커 (X-ray)
      const stGeo = new THREE.CylinderGeometry(26, 26, 1, 24);
      const stMesh = new THREE.InstancedMesh(stGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false }), line.stations.length);
      line.stations.forEach((s, k) => { _m.makeTranslation(s.x, 1.5, s.z); stMesh.setMatrixAt(k, _m); });
      stMesh.renderOrder = 21;
      this.xray.add(stMesh);
      const nTrains = Math.max(2, Math.round(line.total / 1400));
      for (let k = 0; k < nTrains; k++) {
        this.trains.push({ line, s: (line.total * k) / nTrains, dir: k % 2 ? -1 : 1, dwell: 0, lastStation: -1, idx: totalTrains++ });
      }
    }
    this.trainMesh = new THREE.InstancedMesh(trainGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.25, transparent: true, opacity: 0.95, depthTest: false }), totalTrains);
    this.trainMesh.renderOrder = 22; this.trainMesh.frustumCulled = false;
    const color = new THREE.Color();
    for (const tr of this.trains) this.trainMesh.setColorAt(tr.idx, color.set(tr.line.color));
    this.xray.add(this.trainMesh);
    this.xray.visible = false;

    // 지상 역 출입구 (항상 표시)
    const entrances = [];
    for (const n of city.nodes) {
      if (!n.stations) continue;
      n.stations.forEach((line, k) => {
        const ox = roadWidth(n.i) / 2 + 4, oz = roadWidth(n.j) / 2 + 4;
        const sx = k % 2 ? -1 : 1, sz = k >= 2 ? -1 : 1;
        entrances.push({ x: n.x + sx * ox, z: n.z + sz * oz, color: line.color });
      });
    }
    const entGeo = new THREE.BoxGeometry(4, 3, 5); entGeo.translate(0, 1.5, 0);
    const entMesh = new THREE.InstancedMesh(entGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.2 }), entrances.length);
    entrances.forEach((e, k) => { _m.makeTranslation(e.x, SLAB_H, e.z); entMesh.setMatrixAt(k, _m); entMesh.setColorAt(k, color.set(e.color)); });
    entMesh.castShadow = true;
    this.group.add(entMesh);
    this.stationCount = entrances.length;
    this.update(0);
  }

  setXray(on) { this.xray.visible = on; }

  update(dt) {
    for (const tr of this.trains) {
      const line = tr.line;
      if (tr.dwell > 0) tr.dwell -= dt;
      else {
        const prev = tr.s;
        tr.s += tr.dir * 22 * dt;
        for (let k = 0; k < line.stationS.length; k++) {
          const ss = line.stationS[k];
          if (k !== tr.lastStation && ((prev < ss && tr.s >= ss) || (prev > ss && tr.s <= ss))) { tr.s = ss; tr.dwell = 6; tr.lastStation = k; break; }
        }
        if (tr.s >= line.total) { tr.s = line.total; tr.dir = -1; tr.lastStation = -1; }
        if (tr.s <= 0) { tr.s = 0; tr.dir = 1; tr.lastStation = -1; }
      }
      // 위치 계산
      let k = 1;
      while (k < line.cum.length - 1 && line.cum[k] < tr.s) k++;
      const a = line.pts[k - 1], b = line.pts[k];
      const segL = line.cum[k] - line.cum[k - 1] || 1;
      const f = (tr.s - line.cum[k - 1]) / segL;
      _p.lerpVectors(a, b, f);
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      _q.setFromAxisAngle(UP, yaw);
      _m.compose(_p, _q, _one);
      this.trainMesh.setMatrixAt(tr.idx, _m);
    }
    this.trainMesh.instanceMatrix.needsUpdate = true;
  }
}
