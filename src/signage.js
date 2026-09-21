// 도시 야경 요소: 상가 네온 간판, 고층 전광판(스크롤 애니메이션)
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

function signAtlas() {
  const N = 8, T = 64, size = N * T;
  const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d'); const r = mulberry32(77);
  const pal = [[255, 40, 90], [40, 200, 255], [255, 200, 40], [90, 255, 120], [255, 110, 40], [200, 80, 255], [255, 255, 255], [255, 60, 60]];
  for (let i = 0; i < N * N; i++) {
    const x = (i % N) * T, y = Math.floor(i / N) * T;
    const c = pal[Math.floor(r() * pal.length)];
    const dark = r() < 0.5;
    ctx.fillStyle = dark ? `rgb(${c[0] * 0.15 | 0},${c[1] * 0.15 | 0},${c[2] * 0.15 | 0})` : `rgb(${c[0]},${c[1]},${c[2]})`;
    ctx.fillRect(x, y, T, T);
    ctx.fillStyle = dark ? `rgb(${c[0]},${c[1]},${c[2]})` : 'rgb(20,20,30)';
    // 가짜 글자 블록
    const words = 2 + Math.floor(r() * 3);
    for (let w = 0; w < words; w++) { const ww = 8 + r() * 14, hh = 10 + r() * 8; ctx.fillRect(x + 6 + w * 18 + r() * 4, y + 14 + r() * 20, ww, hh); }
    if (r() < 0.4) { ctx.fillStyle = 'rgb(255,255,255)'; ctx.fillRect(x + 4, y + T - 12, T - 8, 3); }
  }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

export function buildSignage(city, U) {
  const group = new THREE.Group();
  const rng = mulberry32(909);
  const mains = city.buildings.filter((b) => b.main);
  const m = new THREE.Matrix4();
  // 2) 간판 + 전광판: 상업 건물 1층 네온 간판(정면), 고층 오피스 중간 높이 전광판(스크롤)
  const tex = signAtlas();
  const signs = [];
  for (const b of mains) {
    if (b.kind === 1) continue;
    if (b.h >= 8 && b.h < 70 && rng() < 0.55) { // 네온 간판: 4면 중 임의 1~2면
      const faces = rng() < 0.4 ? 2 : 1;
      for (let f = 0; f < faces; f++) {
        const side = Math.floor(rng() * 4);
        const sw = Math.min(b.w, b.d) * (0.35 + rng() * 0.35), sh = 1.3 + rng() * 0.8;
        signs.push({ b, side, w: sw, h: sh, y: b.y + 4.2 + rng() * 1.5, tile: Math.floor(rng() * 64), anim: 0 });
      }
    }
    if (b.kind === 0 && b.h > 80 && rng() < 0.35) { // 전광판
      const side = Math.floor(rng() * 4);
      signs.push({ b, side, w: Math.min(b.w, b.d) * 0.7, h: 9 + rng() * 6, y: b.y + b.h * (0.25 + rng() * 0.4), tile: Math.floor(rng() * 64), anim: 1 + Math.floor(rng() * 3) });
    }
  }
  const geo = new THREE.PlaneGeometry(1, 1);
  const tiles = new Float32Array(signs.length * 2), anims = new Float32Array(signs.length), phases = new Float32Array(signs.length);
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = U.uTime; s.uniforms.uNight = U.uNight;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aTile; attribute float aAnim; attribute float aPhase; varying vec2 vTile; varying float vAnim; varying float vPhase; varying vec2 vUvS;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTile = aTile; vAnim = aAnim; vPhase = aPhase; vUvS = uv;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime, uNight; varying vec2 vTile; varying float vAnim; varying float vPhase; varying vec2 vUvS;')
      .replace('#include <map_fragment>', `
        vec2 uv = vUvS;
        vec3 sc;
        if (vAnim < 0.5) {
          sc = texture2D(map, (vTile + clamp(uv, 0.02, 0.98)) / 8.0).rgb;
        } else {
          // 전광판: 색상 띠가 흐르고 주기적으로 화면이 바뀜
          float t = uTime * 0.25 + vPhase;
          float band = fract(uv.x * 3.0 - t * (vAnim));
          vec3 c1 = vec3(0.5 + 0.5 * sin(t * 1.3 + vPhase * 6.0), 0.5 + 0.5 * sin(t * 0.9 + 2.0), 0.5 + 0.5 * sin(t * 1.7 + 4.0));
          vec3 c2 = 1.0 - c1;
          float px = step(0.5, fract(uv.x * 40.0)) * step(0.5, fract(uv.y * 12.0)); // LED 픽셀 격자
          sc = mix(mix(c1, c2, step(0.5, band)), vec3(0.9), 0.45) * (0.75 + 0.25 * px) * 0.7; // 채도·밝기 낮춘 전광판
          float slide = floor(fract(t * 0.15) * 3.0);
          if (slide > 1.5) sc = texture2D(map, (vTile + clamp(uv, 0.02, 0.98)) / 8.0).rgb * 1.2;
        }
        float on = mix(0.12, 1.4, uNight);
        diffuseColor.rgb = sc * on;`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, signs.length);
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  signs.forEach((sg, k) => {
    const b = sg.b;
    const yaw = [0, Math.PI / 2, Math.PI, -Math.PI / 2][sg.side];
    const off = 0.25;
    const pos = [[b.x, b.z + b.d / 2 + off], [b.x + b.w / 2 + off, b.z], [b.x, b.z - b.d / 2 - off], [b.x - b.w / 2 - off, b.z]][sg.side];
    q.setFromAxisAngle(up, yaw); p.set(pos[0], sg.y + sg.h / 2, pos[1]); sc.set(sg.w, sg.h, 1);
    m.compose(p, q, sc); mesh.setMatrixAt(k, m);
    tiles[k * 2] = sg.tile % 8; tiles[k * 2 + 1] = Math.floor(sg.tile / 8); anims[k] = sg.anim; phases[k] = rng() * 10;
  });
  geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 2));
  geo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(anims, 1));
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  group.add(mesh);
  group.userData.counts = { signs: signs.length };
  return group;
}
