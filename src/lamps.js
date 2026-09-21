// 도로변 가로등: 기둥 + 발광 등 (밤에 블룸으로 번짐)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bridgeY, SLAB_H } from './citygen.js';

const SPACING = 30;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);

export function buildLamps(city, U) {
  const spots = [];
  for (const e of city.edges) {
    if (e.path) continue;
    const { a, b, width } = e;
    const L = e.length, ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    const rx = -uz, rz = ux;
    const sp = e.wide ? SPACING : SPACING * 1.4;
    for (let t = sp / 2; t < L - 4; t += sp) {
      const y = e.bridge ? bridgeY(L, t) : (a.y || 0) + ((b.y || 0) - (a.y || 0)) * (t / L);
      for (const side of [-1, 1]) {
        const off = width / 2 + 0.6;
        spots.push({ x: a.x + ux * t + rx * side * off, z: a.z + uz * t + rz * side * off, y: y + (e.highway || e.bridge ? 0.12 : SLAB_H), yaw: Math.atan2(-rx * side, -rz * side) });
      }
    }
  }
  const pole = new THREE.CylinderGeometry(0.09, 0.13, 8, 6).toNonIndexed(); pole.translate(0, 4, 0);
  const arm = new THREE.BoxGeometry(0.12, 0.12, 2.4).toNonIndexed(); arm.translate(0, 7.9, 1.2);
  const poleMesh = new THREE.InstancedMesh(mergeGeometries([pole, arm]), new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.7, metalness: 0.5 }), spots.length);
  const head = new THREE.BoxGeometry(0.5, 0.22, 0.9); head.translate(0, 7.8, 2.2);
  const headMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  const headMesh = new THREE.InstancedMesh(head, headMat, spots.length);
  spots.forEach((s, k) => {
    _q.setFromAxisAngle(UP, s.yaw); _p.set(s.x, s.y, s.z); _m.compose(_p, _q, _one);
    poleMesh.setMatrixAt(k, _m); headMesh.setMatrixAt(k, _m);
  });
  poleMesh.castShadow = true;
  const group = new THREE.Group();
  group.add(poleMesh, headMesh);
  group.userData.count = spots.length;
  const warm = new THREE.Color(1.0, 0.72, 0.32);
  group.userData.update = () => {
    const night = U.uNight.value;
    headMat.color.copy(warm).multiplyScalar(0.12 + night * 2.2);
  };
  return group;
}
