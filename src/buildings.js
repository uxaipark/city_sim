// 건물(인스턴싱 + 절차적 창문 셰이더) 및 블록 슬래브
import * as THREE from 'three';
import { SLAB_H } from './citygen.js';
import { GLSL_NOISE } from './glsl.js';
import { buildInteriorAtlas, buildFarTexture } from './interiors.js';

export function buildBuildings(city, U) {
  const list = city.buildings;
  const count = list.length;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const sizes = new Float32Array(count * 3), seeds = new Float32Array(count), voffs = new Float32Array(count), caps = new Float32Array(count * 4), kinds = new Float32Array(count);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.04 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  list.forEach((b, k) => {
    dummy.position.set(b.x, b.y, b.z);
    dummy.scale.set(b.w, b.h, b.d);
    dummy.updateMatrix();
    mesh.setMatrixAt(k, dummy.matrix);
    mesh.setColorAt(k, color.setRGB(b.color[0], b.color[1], b.color[2]));
    sizes[k * 3] = b.w; sizes[k * 3 + 1] = b.h; sizes[k * 3 + 2] = b.d;
    seeds[k] = b.seed; voffs[k] = b.vOff || 0; kinds[k] = b.kind || 0;
    if (b.cap) { // 위층 footprint (로컬 단위: 중심 오프셋, 반폭)
      caps[k * 4] = (b.cap.x - b.x) / b.w; caps[k * 4 + 1] = (b.cap.z - b.z) / b.d;
      caps[k * 4 + 2] = b.cap.w / b.w * 0.5; caps[k * 4 + 3] = b.cap.d / b.d * 0.5;
    }
  });
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  geo.setAttribute('aVOff', new THREE.InstancedBufferAttribute(voffs, 1));
  geo.setAttribute('aCap', new THREE.InstancedBufferAttribute(caps, 4));
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1));
  const interior = buildInteriorAtlas();
  const farTex = buildFarTexture();
  mesh.castShadow = true; mesh.receiveShadow = true;

  mat.onBeforeCompile = (s) => {
    s.uniforms.uNight = U.uNight; s.uniforms.uInterior = { value: interior }; s.uniforms.uFar = { value: farTex }; s.uniforms.uLightSeed = { value: Math.random() * 100 }; // 로딩마다 창문 점등 패턴 랜덤 s.uniforms.uLate = U.uLate;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aSize; attribute float aSeed; attribute float aVOff; attribute vec4 aCap; attribute float aKind;
        varying vec3 vLocal; varying vec3 vSize; varying float vSeed; varying vec3 vNL; varying float vVOff; varying vec4 vCap; varying float vKind; varying vec3 vWPos;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 wp4 = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
          #endif
          vWPos = (modelMatrix * wp4).xyz; }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLocal = position; vSize = aSize; vSeed = aSeed; vNL = normal; vVOff = aVOff; vCap = aCap; vKind = aKind;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLocal; varying vec3 vSize; varying float vSeed; varying vec3 vNL; varying float vVOff; varying vec4 vCap; varying float vKind; varying vec3 vWPos; uniform float uNight; uniform float uLate; uniform sampler2D uInterior; uniform sampler2D uFar; uniform float uLightSeed;
        ${GLSL_NOISE}
        vec3 gWinEmissive = vec3(0.0);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 base = diffuseColor.rgb;
          vec3 nl = vNL;
          if (abs(nl.y) < 0.5) {
            float along = abs(nl.x) > 0.5 ? vLocal.z * vSize.z : vLocal.x * vSize.x;
            float v = vLocal.y * vSize.y + vVOff;
            float floorH = 3.3 + 0.7 * fract(vSeed * 7.1);
            float winW = 2.4 + 1.8 * fract(vSeed * 3.3);
            float style = fract(vSeed * 13.7);
            vec2 cell = vec2(floor(along / winW), floor(v / floorH));
            vec2 f = vec2(fract(along / winW), fract(v / floorH));
            vec2 aa = fwidth(vec2(along / winW, v / floorH)) * 1.5; // fract 이전의 연속 좌표로 미분 → 셀 경계에서 lod 가 튀지 않음(격자 밝은 선 방지)
            float lod = 1.0 - smoothstep(0.25, 0.9, max(aa.x, aa.y));
            // ── 창틀 두께: 건물마다 다르다. 커튼월(아주 얇음, 통유리처럼) / 보통 / 두꺼운 벽·작은 창 ──
            float fx, fy;
            float r1 = fract(vSeed * 17.3), r2 = fract(vSeed * 19.1);
            if (style < 0.25)      { fx = 0.012 + 0.035 * r1; fy = 0.03 + 0.07 * r2; }   // 커튼월: 멀리언만 가늘게
            else if (style < 0.7)  { fx = 0.08 + 0.08 * r1;   fy = 0.15 + 0.13 * r2; }   // 일반 창
            else                   { fx = 0.18 + 0.13 * r1;   fy = 0.27 + 0.14 * r2; }   // 두꺼운 벽, 작은 창
            float x0 = fx, x1 = 1.0 - fx, y0 = fy * 1.2, y1 = 1.0 - fy * 0.8;             // 창은 층 안에서 약간 위쪽
            float wx = smoothstep(x0, x0 + aa.x, f.x) * (1.0 - smoothstep(x1 - aa.x, x1, f.x));
            float wy = smoothstep(y0, y0 + aa.y, f.y) * (1.0 - smoothstep(y1 - aa.y, y1, f.y));
            float win = wx * wy * lod;
            float glassy = smoothstep(60.0, 200.0, vSize.y);
            vec3 glass = mix(vec3(0.22, 0.27, 0.33), vec3(0.40, 0.55, 0.70), glassy) * (0.75 + 0.35 * fract(vSeed * 5.0));
            float cover = (x1 - x0) * (y1 - y0);      // 셀 안에서 유리가 차지하는 비율
            float avgWin = cover * 0.55;
            float curtain = smoothstep(0.07, 0.03, fx); // 커튼월 정도 (프레임이 유리와 비슷한 어두운 금속/유리색)
            // ── 창문 내부 장면: 건물 용도(사무실/주거/혼합)와 층(1층 상점)에 따라 아틀라스 타일 선택 ──
            vec2 wuv = vec2((f.x - x0) / (x1 - x0), (f.y - y0) / (y1 - y0));
            float vSeedL = fract(vSeed + uLightSeed * 0.731); // 점등 패턴용 시드 (페이지 로딩마다 달라짐)
            float hcell = hash21(cell * 3.1 + vSeedL * 41.0);
            float hcell2 = hash21(cell * 7.7 + vSeedL * 13.0);
            bool ground = cell.y < 0.5 && vVOff < 0.5 && vKind != 1.0;
            float idx;
            if (ground) idx = 200.0 + floor(hcell * 24.0);
            else if (vKind < 0.5) idx = floor(hcell * 100.0);
            else if (vKind < 1.5) idx = 100.0 + floor(hcell * 100.0);
            else idx = hcell2 < 0.5 ? floor(hcell * 100.0) : 100.0 + floor(hcell * 100.0);
            // 점등 여부: 밤이 깊을수록(uLate) 소등이 늘어남 (사무실은 더 빨리 꺼짐)
            float offRate = uLate * (vKind < 0.5 ? 0.55 : 0.35);
            float lit = step(0.42 + 0.35 * fract(vSeedL * 9.0) + offRate, hash21(cell + vSeedL * 97.0));
            // 큰 빌딩: 층 단위 패턴 (약 8% 전층 점등, 약 7% 절반 점등)
            if (vSize.y > 40.0) {
              float fp = hash21(vec2(cell.y, vSeedL * 53.0));
              float halfSide = step(0.0, along) == step(0.5, hash21(vec2(cell.y, vSeedL * 71.0))) ? 1.0 : 0.0;
              if (fp < 0.08 * (1.0 - uLate * 0.6)) lit = 1.0;
              else if (fp < 0.15) lit = max(lit * 0.15, halfSide * (1.0 - step(0.5, uLate * hash21(vec2(cell.y, vSeedL)))));
            }
            // 건물 단위 패턴: 약 5% 는 절반(좌/우 또는 상/하)만 점등, 약 5% 는 몇 개 층만 남기고 소등
            float bmask = 1.0;
            if (vSize.y > 25.0) {
              float bmode = hash21(vec2(fract(vSeedL * 3.3), 17.0));
              if (bmode < 0.05) {
                float vert = step(0.5, hash21(vec2(fract(vSeedL * 5.1), 5.0)));
                float sideOn = step(0.5, hash21(vec2(fract(vSeedL * 2.7), 9.0)));
                float hf = vert > 0.5 ? step(0.5, vLocal.y) : step(0.0, along);
                bmask = abs(hf - sideOn) < 0.5 ? 1.0 : 0.0;
              } else if (bmode < 0.10) {
                bmask = step(0.88, hash21(vec2(cell.y, fract(vSeedL * 7.7) * 77.0)));   // 층의 약 12% 만 점등
              }
            }
            lit *= bmask;
            // 건물이 완전히 꺼지지는 않는다: 창의 약 3.5% 는 복도·탕비실·현관 등 상시 점등 (소등 시간·건물 패턴과 무관)
            float always = step(0.965, hash21(cell * 5.3 + vSeedL * 23.0));
            if (always > 0.5) {
              lit = 1.0;
              float blk = floor(hcell * 8.0);
              idx = vKind < 0.5 || (vKind > 1.5 && hcell2 < 0.5) ? blk * 12.0 + 9.0 + step(0.5, hcell2) : 100.0 + blk * 12.0 + 10.0 + step(0.5, hcell2); // 탕비실/복도 타일, 주거는 커튼 방
            }
            if (lit < 0.5) idx = 224.0 + floor(hcell * 32.0);
            // 시차: 시선 방향에 따라 실내가 살짝 밀려 보이게 (가짜 깊이)
            vec3 vdir = normalize(cameraPosition - vWPos);
            vec3 T = abs(nl.x) > 0.5 ? vec3(0.0, 0.0, sign(nl.x)) : vec3(-sign(nl.z), 0.0, 0.0);
            float ndvRaw = abs(dot(vdir, nl));
            float ndv = max(ndvRaw, 0.25);
            // 시야각 효과: 정면에서 볼수록 실내가 밝고, 측면(스치는 각)일수록 유리 반사·창틀 깊이 때문에 어두워진다
            float facing = mix(0.18, 1.0, pow(ndvRaw, 0.8));
            vec2 par = vec2(dot(vdir, T), vdir.y) / ndv * 0.10;
            vec2 tuv = clamp(wuv * 0.78 + 0.11 - par, 0.02, 0.98);
            vec2 tile = vec2(mod(idx, 16.0), floor(idx / 16.0));
            vec3 room = texture2D(uInterior, (tile + tuv) / 16.0).rgb;
            // 낮: 유리 반사 + 희미한 실내, 밤: 실내가 빛남
            vec3 dayWin = mix(room * 0.35, glass, 0.55);
            vec3 col = mix(mix(base, glass * 0.55, curtain), dayWin, max(win, (1.0 - lod) * avgWin));
            if (style > 0.72) col *= 1.0 - 0.18 * smoothstep(0.86, 0.9, f.y) * lod;
            col *= 0.72 + 0.28 * smoothstep(0.0, 6.0, vLocal.y * vSize.y);
            // 색온도: 사무실 차가운 형광(5000K), 주거 따뜻한 전구(2700K), 혼합은 창마다 섞임
            vec3 tint = vKind < 0.5 ? vec3(1.0, 0.88, 0.70) : vKind < 1.5 ? vec3(1.0, 0.78, 0.54) : mix(vec3(1.0, 0.88, 0.70), vec3(1.0, 0.78, 0.54), step(0.5, hcell2)); // 사무실 할로겐(3000K), 주거 백열(2700K)
            float litFrac = (0.25 + 0.5 * fract(vSeedL * 9.0)) * (1.0 - offRate);
            // ── 원거리: 창이 픽셀보다 작아지면 밉맵 창불빛 텍스처로 대체 (거리별 평균이 자연스러운 점묘 야경) ──
            vec2 fuv = (cell + f) / 64.0 + vec2(fract(vSeedL * 7.7), fract(vSeedL * 3.9));
            vec3 farI = (texture2D(uFar, fuv).rgb * bmask + vec3(0.35 * always)) * (cover / 0.45);
            float farScale = (0.7 + 0.6 * fract(vSeedL * 9.0)) * max(0.0, 1.0 - offRate * 1.5); // 원거리도 근거리와 같은 비율로 소등
            if (vSize.y > 40.0) { float fp2 = hash21(vec2(cell.y, vSeedL * 53.0)); if (fp2 < 0.08 * (1.0 - uLate * 0.6)) farI = max(farI, vec3(0.6 * wy * bmask)); }
            vec3 farTint = mix(tint, vec3(1.0), 0.3);   // 텍스처에 구운 창 색 편차를 살리되 건물 종류 색온도도 반영
            vec3 roomLit = room * tint * 0.8; // 창문은 블룸 임계값(1.0) 아래로 — 번짐/글레어 없이 은은하게
            gWinEmissive = (roomLit * win * lod * lit + farTint * (1.0 - lod) * farI * farScale * 0.9) * uNight
                         + room * win * lod * (1.0 - lit) * 0.06 * uNight;
            gWinEmissive *= facing;
            // 밤에는 외벽 자체가 어두워야 불빛만 보인다 (달빛에 회색으로 뜨지 않게)
            col *= 1.0 - 0.5 * uNight;
            diffuseColor.rgb = col;
          } else if (nl.y > 0.5) {
            float hv = hash21(floor(vLocal.xz * vSize.xz / 5.0) + vSeed);
            vec3 roof = base * 0.55 + vec3(0.06);
            roof *= 0.88 + 0.24 * hv;
            float edge = smoothstep(0.42, 0.47, max(abs(vLocal.x), abs(vLocal.z)));
            roof = mix(roof, base * 0.8, edge);
            if (vCap.z > 0.0) {
              // 위층 벽 아래 접촉 그림자 (미터 단위 거리로 감쇠)
              vec2 dxz = (abs(vLocal.xz - vCap.xy) - vCap.zw) * vSize.xz;
              float dm = max(dxz.x, dxz.y);
              roof *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 5.0, dm));
            }
            diffuseColor.rgb = roof;
          }
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += gWinEmissive;`);
  };
  mat.customProgramCacheKey = () => 'buildings';
  mesh.userData.interior = interior;
  return mesh;
}

export function buildSlabs(city, U) {
  const blocks = city.blocks;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geo, mat, blocks.length);
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  const kinds = new Float32Array(blocks.length);
  blocks.forEach((b, k) => {
    dummy.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    dummy.scale.set(b.x1 - b.x0, SLAB_H, b.z1 - b.z0);
    dummy.updateMatrix();
    mesh.setMatrixAt(k, dummy.matrix);
    if (b.type === 'park') { color.setRGB(0.34, 0.50, 0.20); kinds[k] = 1; }
    else if (b.type === 'plaza') { color.setRGB(0.80, 0.77, 0.70); kinds[k] = 2; }
    else { color.setRGB(0.70, 0.68, 0.64); kinds[k] = 0; }
    mesh.setColorAt(k, color);
  });
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1));
  mesh.receiveShadow = true;
  mat.onBeforeCompile = (s) => {
    s.uniforms.uNight = U.uNight;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aKind; varying float vKind; varying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKind = aKind;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 wp4 = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
          #endif
          vWPos = (modelMatrix * wp4).xyz; }`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vKind; varying vec3 vWPos; uniform float uNight;
        ${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float n = snoise(vWPos.xz * 0.35) * 0.5 + 0.5;
          float n2 = snoise(vWPos.xz * 2.5) * 0.5 + 0.5;
          if (vKind > 0.5 && vKind < 1.5) {
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.50, 0.58, 0.24), n2 * 0.4) * (0.85 + 0.3 * n);
          } else {
            vec2 g = abs(fract(vWPos.xz / 2.0) - 0.5);
            float line = 1.0 - smoothstep(0.44, 0.48, max(g.x, g.y));
            diffuseColor.rgb *= (0.92 + 0.12 * n) * (1.0 - 0.06 * line * (1.0 - smoothstep(0.3, 1.0, fwidth(vWPos.x))));
          }
        }`);
  };
  mat.customProgramCacheKey = () => 'slabs';
  return mesh;
}
