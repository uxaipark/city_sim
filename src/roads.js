// 도로망 지오메트리 + 차선/횡단보도/가로등 셰이더, 교량
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { riverDist, RIVER_HALF, bridgeY, RIVER_DEPTH } from './citygen.js';
import { GLSL_NOISE } from './glsl.js';

export const ROAD_Y = 0.12;

export function buildRoads(city, U) {
  const pos = [], nor = [], uv = [], meta = [], idx = [];
  let vi = 0;
  // 임의 방향 세그먼트: u=0 좌측, u=1 우측(진행방향 a→b 기준), along = a 기준 거리
  function seg(ax, az, bx, bz, w, ya, yb, kind, sigA = 0, sigB = 0, along0 = 0) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L * (w / 2), nz = dx / L * (w / 2);
    pos.push(ax - nx, ya, az - nz, ax + nx, ya, az + nz, bx - nx, yb, bz - nz, bx + nx, yb, bz + nz);
    uv.push(0, 0, 1, 0, 0, L, 1, L);
    for (let k = 0; k < 4; k++) { nor.push(0, 1, 0); meta.push(L, w, along0, kind + 2 * sigA + 4 * sigB); } // meta.z = 차선 점선 위상
    idx.push(vi, vi + 1, vi + 2, vi + 2, vi + 1, vi + 3);
    vi += 4;
  }
  for (const e of city.edges) {
    if (e.path) continue;
    const { a, b, width } = e;
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
    // 각 끝 노드의 교차로 반폭만큼 잘라낸다 (폴리라인 노드는 1.5)
    const hcA = (e.highway || e.ramp) && a.poly ? 1.5 : (e.axis === 0 ? a.wv : a.wh) / 2;
    const hcB = (e.highway || e.ramp) && b.poly ? 1.5 : (e.axis === 0 ? b.wv : b.wh) / 2;
    const ya = (a.y || 0) + ROAD_Y, yb = (b.y || 0) + ROAD_Y;
    if (e.bridge) {
      // 교량: 종단 프로파일을 따라 잘게 나눈다
      const t0 = hcA, t1 = L - hcB, nseg = Math.ceil((t1 - t0) / 8);
      for (let k = 0; k < nseg; k++) {
        const ta = t0 + ((t1 - t0) * k) / nseg, tb = t0 + ((t1 - t0) * (k + 1)) / nseg;
        seg(a.x + ux * ta, a.z + uz * ta, a.x + ux * tb, a.z + uz * tb, width, ROAD_Y + bridgeY(L, ta), ROAD_Y + bridgeY(L, tb), 0, k === 0 ? (a.signal ? 1 : 0) : 0, k === nseg - 1 ? (b.signal ? 1 : 0) : 0, ta);
      }
    } else {
      seg(a.x + ux * hcA, a.z + uz * hcA, b.x - ux * hcB, b.z - uz * hcB, width, ya, yb, 0, a.signal ? 1 : 0, b.signal ? 1 : 0, hcA);
    }
    if (e.highway || e.ramp) { // 폴리라인 이음새를 메우는 짧은 조각
      if (a.poly) seg(a.x - ux * 1.6, a.z - uz * 1.6, a.x + ux * 1.6, a.z + uz * 1.6, width, ya, ya, 1);
    }
  }
  for (const n of city.nodes) {
    if (n.poly || n.park || !n.edges.some((e) => !e.path)) continue;
    const wv = n.wv, wh = n.wh;
    seg(n.x - wv / 2, n.z, n.x + wv / 2, n.z, wh, ROAD_Y, ROAD_Y, 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aMeta', new THREE.Float32BufferAttribute(meta, 4));
  geo.setIndex(idx);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uNight = U.uNight;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aMeta; varying vec4 vMeta; varying vec2 vUvR; varying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMeta = aMeta; vUvR = uv;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vMeta; varying vec2 vUvR; varying vec3 vWPos; uniform float uNight;
        vec3 gRoadEmissive = vec3(0.0);
        ${GLSL_NOISE}
        float lineMask(float d, float hw, float aa) { return 1.0 - smoothstep(hw, hw + aa, d); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float u = vUvR.x, along = vUvR.y, L = vMeta.x, W = vMeta.y, phase = vMeta.z;
          float kindRaw = vMeta.w;
          float kind = mod(kindRaw, 2.0);
          float sigA = mod(floor(kindRaw / 2.0), 2.0), sigB = floor(kindRaw / 4.0);
          float a = (u - 0.5) * W;
          float n = snoise(vWPos.xz * 0.11) * 0.5 + 0.5;
          float n2 = snoise(vWPos.xz * 0.9) * 0.5 + 0.5;
          vec3 col = mix(vec3(0.15, 0.15, 0.16), vec3(0.24, 0.24, 0.25), n) * (0.9 + 0.2 * n2);
          float aa = max(fwidth(a), 0.02);
          float fade = 1.0 - smoothstep(0.3, 1.1, aa);
          float white = 0.0, yellow = 0.0;
          if (kind < 0.5 && fade > 0.001) {
            if (W > 20.0) {
              yellow = lineMask(abs(abs(a) - 0.3), 0.1, aa);
              float dash = step(fract((along + phase) / 12.0), 0.5);
              white = max(lineMask(abs(abs(a) - 5.0), 0.08, aa), lineMask(abs(abs(a) - 10.0), 0.08, aa)) * dash;
              white = max(white, lineMask(abs(abs(a) - 15.5), 0.1, aa));
            } else {
              yellow = lineMask(abs(a), 0.08, aa) * step(fract((along + phase) / 8.0), 0.5);
            }
            if (L > 30.0) {
              bool plus = u > 0.5;
              float dEnd = plus ? (L - along) : along;
              float sigEnd = plus ? sigB : sigA;
              float dNear = min(along, L - along);
              float sigNear = along < L - along ? sigA : sigB;
              float stopL = step(4.2, dEnd) * step(dEnd, 5.0) * sigEnd;
              float cw = step(0.6, dNear) * step(dNear, 3.6) * step(0.5, fract((a + 0.4) / 1.6)) * sigNear;
              white = max(white, max(stopL, cw));
            }
          }
          col = mix(col, vec3(0.95, 0.78, 0.25), yellow * fade * 0.9);
          col = mix(col, vec3(0.90), white * fade * 0.85);
          diffuseColor.rgb = col;
          if (kind < 0.5) {
            // 가로등 (30 m 간격, 양측): 넓게 퍼지는 빛 웅덩이가 서로 겹쳐 어두운 구간이 거의 없다
            float sp = W > 20.0 ? 30.0 : 42.0;
            float lp = (fract((along + phase - sp * 0.5) / sp) - 0.5) * sp;
            float da = abs(a) - (W * 0.5 + 0.6);
            float g = exp(-(lp * lp) / 320.0 - (da * da) / 260.0);
            float g2 = exp(-(lp * lp) / 90.0 - (da * da) / 60.0); // 등 바로 아래 밝은 중심
            gRoadEmissive = vec3(1.0, 0.72, 0.32) * (g * 0.10 + g2 * 0.09) * uNight;
          } else {
            gRoadEmissive = vec3(1.0, 0.72, 0.32) * 0.07 * uNight;
          }
          gRoadEmissive += col * 0.03 * uNight;
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gRoadEmissive;');
  };
  mat.customProgramCacheKey = () => 'roads';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true; mesh.castShadow = true; // 고가/교량 노면도 그림자를 드리운다
  return mesh;
}

// 공원 산책로: 곡선 체인을 마이터 리본으로
export function buildPaths(city) {
  const pos = [], idx = [];
  let vi = 0;
  const y = 0.35 + 0.03;
  for (const ch of city.parkChains) {
    const pts = ch.pts, hw = ch.hw, n = pts.length;
    if (n < 2) continue;
    for (let k = 0; k < n; k++) {
      const p = pts[k], a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
      let tx = b.x - a.x, tz = b.z - a.z; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      const nx = -tz * hw, nz = tx * hw;
      pos.push(p.x + nx, y, p.z + nz, p.x - nx, y, p.z - nz);
      if (k > 0) { const v = vi + k * 2; idx.push(v - 2, v, v - 1, v - 1, v, v + 1); }
    }
    vi += n * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xc9b58f, roughness: 1, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  return mesh;
}

// 두께 있는 리본 (상판/난간/고가 구조물): 폴리라인 (x,y,z) → 윗면·아랫면·측면·끝면
function thickStrip(pts, hw, th, topOffset = 0) {
  const v = [];
  const n = pts.length;
  const L = [], R = [];
  for (let k = 0; k < n; k++) {
    const p = pts[k], a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
    let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    L.push([p.x + tz * hw, p.y + topOffset, p.z - tx * hw]); R.push([p.x - tz * hw, p.y + topOffset, p.z + tx * hw]);
  }
  const quad = (p0, p1, p2, p3) => { v.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3); };
  const dn = (p) => [p[0], p[1] - th, p[2]];
  for (let k = 1; k < n; k++) {
    const l0 = L[k - 1], r0 = R[k - 1], l1 = L[k], r1 = R[k];
    quad(l0, l1, r1, r0);                       // top
    quad(dn(r0), dn(r1), dn(l1), dn(l0));       // bottom
    quad(dn(l0), dn(l1), l1, l0);               // left side
    quad(r0, r1, dn(r1), dn(r0));               // right side
  }
  quad(dn(L[0]), L[0], R[0], dn(R[0]));
  quad(R[n - 1], L[n - 1], dn(L[n - 1]), dn(R[n - 1]));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export function buildBridges(city) {
  const parts = [];
  const concrete = [];
  // 강을 건너는 교량: 경사로 + 상판(두께 2 m) + 난간 + 교각
  for (const e of city.edges) {
    if (!e.bridge) continue;
    const { a, b, width } = e;
    const L = e.length, ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    const prof = [];
    for (let t = 0; t <= L + 0.01; t += 8) { const tt = Math.min(t, L); prof.push({ x: a.x + ux * tt, y: bridgeY(L, tt), z: a.z + uz * tt }); }
    concrete.push(thickStrip(prof, width / 2 + 2, 2.0, -0.02));
    for (const side of [-1, 1]) {
      const rail = prof.map((p) => ({ x: p.x - uz * side * (width / 2 + 1.6), y: p.y + 1.2, z: p.z + ux * side * (width / 2 + 1.6) }));
      concrete.push(thickStrip(rail, 0.2, 1.2));
    }
    for (let t = 20; t < L - 10; t += 24) {
      const px = a.x + ux * t, pz = a.z + uz * t, top = bridgeY(L, t) - 2;
      const bottom = riverDist(px, pz) < RIVER_HALF + 40 ? -RIVER_DEPTH - 2 : -1;
      if (top - bottom < 1) continue;
      for (const side of [-1, 1]) {
        const pil = new THREE.CylinderGeometry(1.3, 1.6, top - bottom, 8);
        pil.translate(px - uz * side * (width / 2 - 3), (top + bottom) / 2, pz + ux * side * (width / 2 - 3));
        concrete.push(pil);
      }
    }
  }
  // 고가 고속도로: 상판(두께 2.5 m) + 난간 + 교각/캡
  for (const hw of city.highways || []) {
    if (!hw.elevated) continue;
    const pts = hw.pts.map((p) => ({ x: p.x, y: p.y !== undefined ? p.y : hw.y, z: p.z }));
    concrete.push(thickStrip(pts, hw.width / 2 + 1.2, hw.ramp ? 1.6 : 2.5, -0.02));
    for (const side of [-1, 1]) {
      const rail = [];
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k], a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
        let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        rail.push({ x: p.x - tz * side * (hw.width / 2 + 0.9), y: p.y + 1.1, z: p.z + tx * side * (hw.width / 2 + 0.9) });
      }
      concrete.push(thickStrip(rail, 0.18, 1.1));
    }
    let acc = 0;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k], L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let d = acc === 0 ? 0 : 30 - acc; d < L; d += 30) {
        const t = d / L, px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
        const yHere = a.y + (b.y - a.y) * t;
        const top = yHere - (hw.ramp ? 1.6 : 2.5), bottom = hw.ramp ? -2 : -RIVER_DEPTH;
        if (top - bottom < 2.5) continue;
        const pil = new THREE.CylinderGeometry(hw.ramp ? 0.9 : 1.6, hw.ramp ? 1.1 : 2.0, top - bottom, 8);
        pil.translate(px, (top + bottom) / 2, pz);
        concrete.push(pil);
        const cap = new THREE.BoxGeometry(hw.width + 2, 1.4, 3);
        cap.rotateY(Math.atan2(b.x - a.x, b.z - a.z)); cap.translate(px, top - 0.7, pz);
        concrete.push(cap);
      }
      acc = (acc + L) % 30;
    }
  }
  const group = new THREE.Group();
  if (concrete.length) {
    const geo = mergeGeometries(concrete.map((g) => { const ng = g.index ? g.toNonIndexed() : g; ng.deleteAttribute('uv'); return ng; }));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8d8c88, roughness: 0.9 }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
