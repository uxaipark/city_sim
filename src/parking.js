// 주차장: 공터 슬래브 + 주차선 셰이더 + 주차된 차량 (정적 인스턴싱)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SLAB_H } from './citygen.js';
import { mulberry32 } from './noise.js';

const BAY_W = 2.7, ROW_PERIOD = 17; // 주차면 5 m + 통로 7 m + 주차면 5 m
const COLORS = [[0.92, 0.92, 0.92], [0.1, 0.1, 0.11], [0.75, 0.76, 0.78], [0.7, 0.12, 0.1], [0.15, 0.25, 0.55], [0.85, 0.65, 0.15], [0.3, 0.32, 0.34], [0.45, 0.55, 0.45]];

export function buildParking(city, U) {
  const lots = city.parkingLots;
  const group = new THREE.Group();
  if (!lots.length) return group;
  // 슬래브 (uv = 미터 단위 로컬 좌표)
  const pos = [], uv = [], idx = [], dims = [];
  let vi = 0;
  const y = SLAB_H + 0.02;
  for (const l of lots) {
    const x0 = l.x - l.w / 2, x1 = l.x + l.w / 2, z0 = l.z - l.d / 2, z1 = l.z + l.d / 2;
    pos.push(x0, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
    uv.push(0, 0, l.w, 0, 0, l.d, l.w, l.d);
    for (let k = 0; k < 4; k++) dims.push(l.w, l.d);
    idx.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3); vi += 4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aDims', new THREE.Float32BufferAttribute(dims, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2c2c2f, roughness: 0.95 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uNight = U.uNight;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aDims; varying vec2 vDims; varying vec2 vUvP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDims = aDims; vUvP = uv;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vDims; varying vec2 vUvP; uniform float uNight;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float u = vUvP.x, v = vUvP.y;
          float aa = max(fwidth(u), 0.02);
          float fade = 1.0 - smoothstep(0.3, 1.0, aa);
          float rowV = mod(v - 1.0, ${ROW_PERIOD.toFixed(1)});
          float inBay = step(0.0, rowV) * (1.0 - step(5.0, rowV)) + step(12.0, rowV) * (1.0 - step(17.0, rowV));
          float dBay = ${BAY_W} / 2.0 - abs(mod(u - 1.0, ${BAY_W}) - ${BAY_W} / 2.0); // 가장 가까운 주차면 경계까지 거리
          float bayLine = (1.0 - smoothstep(0.07, 0.07 + aa, dBay)) * inBay;
          float rowLine = 1.0 - smoothstep(0.08, 0.08 + aa, min(abs(rowV - 5.0), abs(rowV - 12.0)));
          float edgeL = 1.0 - smoothstep(0.12, 0.12 + aa, min(min(u, vDims.x - u), min(v, vDims.y - v)));
          float m = max(max(bayLine, rowLine), edgeL) * fade;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9), m * 0.85);
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.72, 0.32) * 0.05 * uNight;');
  };
  mat.customProgramCacheKey = () => 'parking';
  const slab = new THREE.Mesh(geo, mat);
  slab.receiveShadow = true;
  group.add(slab);

  // 주차된 차량
  const rng = mulberry32(4242);
  const spots = [];
  for (const l of lots) {
    const x0 = l.x - l.w / 2, z0 = l.z - l.d / 2;
    for (let v = 1; v + 5 <= l.d - 1; v += ROW_PERIOD) {
      for (let u = 1 + BAY_W / 2; u < l.w - 1; u += BAY_W) {
        if (rng() < 0.62) spots.push({ x: x0 + u, z: z0 + v + 2.5, yaw: 0 });
        if (v + 17 <= l.d - 1 && rng() < 0.62) spots.push({ x: x0 + u, z: z0 + v + 14.5, yaw: Math.PI });
      }
    }
  }
  const body = new THREE.BoxGeometry(1.8, 0.55, 4.3); body.translate(0, 0.55, 0);
  const cabin = new THREE.BoxGeometry(1.6, 0.55, 2.1); cabin.translate(0, 1.1, -0.3);
  const carGeo = mergeGeometries([body, cabin]);
  const carMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.3 });
  const mesh = new THREE.InstancedMesh(carGeo, carMat, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  spots.forEach((sp, k) => {
    q.setFromAxisAngle(up, sp.yaw + (rng() - 0.5) * 0.06); p.set(sp.x, y, sp.z);
    m.compose(p, q, one); mesh.setMatrixAt(k, m);
    const col = COLORS[Math.floor(rng() * COLORS.length)];
    mesh.setColorAt(k, c.setRGB(col[0], col[1], col[2]));
  });
  mesh.castShadow = true;
  group.add(mesh);
  group.userData.parkedCount = spots.length;
  return group;
}
