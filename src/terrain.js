// 사막 지형 (CPU 변위 + 셰이더 채색) 및 강 수면 셰이더
import * as THREE from 'three';
import { WORLD, terrainHeight, cityMask, riverDist, riverX, RIVER_HALF, RIVER_BANK, vegetation, WATER_Y } from './citygen.js';
import { smoothstep } from './noise.js';
import { GLSL_NOISE } from './glsl.js';

export function buildTerrain(U) {
  const seg = 560;
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let k = 0; k < pos.count; k++) pos.setY(k, terrainHeight(pos.getX(k), pos.getZ(k)));
  geo.computeVertexNormals();

  // 마스크 텍스처: R=도시, G=수면, B=식생, A=강바닥
  const R = 384;
  const data = new Uint8Array(R * R * 4);
  for (let iy = 0; iy < R; iy++) {
    for (let ix = 0; ix < R; ix++) {
      const x = ((ix + 0.5) / R) * WORLD - WORLD / 2, z = ((iy + 0.5) / R) * WORLD - WORLD / 2;
      const rd = riverDist(x, z);
      const o = (iy * R + ix) * 4;
      data[o] = cityMask(x, z) * 255;
      data[o + 1] = (1 - smoothstep(RIVER_HALF + 4, RIVER_HALF + 14, rd)) * 255;
      data[o + 2] = vegetation(x, z) * 255;
      data[o + 3] = (1 - smoothstep(RIVER_HALF, RIVER_HALF + RIVER_BANK, rd)) * 255;
    }
  }
  const mask = new THREE.DataTexture(data, R, R, THREE.RGBAFormat);
  mask.magFilter = THREE.LinearFilter; mask.minFilter = THREE.LinearFilter; mask.needsUpdate = true;

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uMask = { value: mask };
    s.uniforms.uWorld = { value: WORLD };
    s.uniforms.uNight = U.uNight;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; uniform sampler2D uMask; uniform float uWorld; uniform float uNight;
        ${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 muv = vWPos.xz / uWorld + 0.5;
        vec4 m = texture2D(uMask, muv);
        float n1 = snoise(vWPos.xz * 0.0035) * 0.5 + 0.5;
        float n2 = snoise(vWPos.xz * 0.03) * 0.5 + 0.5;
        float n3 = snoise(vWPos.xz * 0.12) * 0.5 + 0.5;
        float ripple = sin(vWPos.x * 0.25 + vWPos.z * 0.08 + snoise(vWPos.xz * 0.015) * 5.0) * 0.5 + 0.5;
        vec3 sand = mix(vec3(0.78, 0.62, 0.40), vec3(0.88, 0.76, 0.54), n1);
        sand = mix(sand, vec3(0.78, 0.60, 0.40), n2 * 0.3);
        sand *= 1.0 - ripple * 0.10 * (1.0 - m.r) - n3 * 0.05;
        vec3 city = mix(vec3(0.58, 0.55, 0.50), vec3(0.68, 0.65, 0.59), n2);
        vec3 col = mix(sand, city, m.r);
        vec3 grass = mix(vec3(0.28, 0.44, 0.17), vec3(0.46, 0.56, 0.22), n2 * 0.7 + n3 * 0.3);
        col = mix(col, grass, m.b * (0.65 + 0.35 * n2));
        vec3 bed = mix(vec3(0.30, 0.27, 0.20), vec3(0.42, 0.38, 0.28), n3);
        col = mix(col, bed, m.a * 0.9);
        diffuseColor.rgb = col;`);
  };
  mat.customProgramCacheKey = () => 'terrain';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

export function buildWater(U, fog) {
  const half = RIVER_HALF + 25;
  const pts = [];
  for (let z = -WORLD / 2; z <= WORLD / 2; z += 25) pts.push(new THREE.Vector2(riverX(z), z));
  const pos = [], uv = [], idx = [];
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    const tx = b.x - a.x, tz = b.y - a.y, tl = Math.hypot(tx, tz);
    const nx = -tz / tl, nz = tx / tl;
    pos.push(p.x - nx * half, WATER_Y, p.y - nz * half, p.x + nx * half, WATER_Y, p.y + nz * half);
    uv.push(0, p.y, 1, p.y);
    if (k > 0) { const v = k * 2; idx.push(v - 2, v, v - 1, v - 1, v, v + 1); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: /* glsl */ `
      varying vec3 vWPos; varying vec2 vUv;
      #include <fog_pars_vertex>
      #include <common>
        #include <logdepthbuf_pars_vertex>
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSkyColor; uniform float uNight;
      varying vec3 vWPos; varying vec2 vUv;
      #include <fog_pars_fragment>
      #include <logdepthbuf_pars_fragment>
      ${GLSL_NOISE}
      float wave(vec2 p, float t) {
        return snoise(p * 0.07 + vec2(t * 0.12, t * 0.08)) * 0.6
             + snoise(p * 0.19 - vec2(t * 0.17, t * 0.04)) * 0.3
             + snoise(p * 0.55 + vec2(0.0, t * 0.25)) * 0.12;
      }
      void main() {
        #include <logdepthbuf_fragment>
        vec2 p = vWPos.xz;
        float t = uTime;
        float e = 0.6;
        float h0 = wave(p, t), hx = wave(p + vec2(e, 0.0), t), hz = wave(p + vec2(0.0, e), t);
        float camD = length(cameraPosition - vWPos);
        float atten = 1.0 / (1.0 + camD * 0.0025);
        vec3 nrm = normalize(vec3(-(hx - h0) * 1.6 * atten, 1.0, -(hz - h0) * 1.6 * atten));
        vec3 view = normalize(cameraPosition - vWPos);
        float fres = pow(1.0 - max(dot(view, nrm), 0.0), 3.0);
        float shore = smoothstep(0.0, 0.22, min(vUv.x, 1.0 - vUv.x));
        vec3 base = mix(vec3(0.16, 0.42, 0.44), vec3(0.04, 0.20, 0.30), shore);
        vec3 col = mix(base, uSkyColor, 0.22 + 0.55 * fres);
        vec3 hv = normalize(view + uSunDir);
        float spec = pow(max(dot(nrm, hv), 0.0), 240.0) * max(uSunDir.y, 0.0);
        col += vec3(1.0, 0.95, 0.85) * spec * 2.5 * atten;
        col *= mix(1.0, 0.18, uNight);
        col += vec3(0.9, 0.7, 0.4) * uNight * 0.03 * (h0 * 0.5 + 0.5);
        gl_FragColor = vec4(col, 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, fog: true, side: THREE.DoubleSide, depthWrite: false,
  });
  mat.uniforms.uTime = U.uTime; mat.uniforms.uSunDir = U.uSunDir; mat.uniforms.uSkyColor = U.uSkyColor; mat.uniforms.uNight = U.uNight;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;
}
