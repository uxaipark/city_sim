// 하늘 돔 + 태양/반구광 + 낮밤 주기
import * as THREE from 'three';
import { GLSL_NOISE } from './glsl.js';

export class Sky {
  constructor(scene, U, sun, hemi, fog, renderer) {
    this.U = U; this.sun = sun; this.hemi = hemi; this.fog = fog; this.renderer = renderer;
    this.uniforms = {
      uSunDir: U.uSunDir, uNight: U.uNight, uTime: U.uTime, uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uDusk: { value: 0 }, uSunUp: { value: 0 },
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunColor: { value: new THREE.Color() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir, uTop, uHorizon, uSunColor, uMoonDir; uniform float uNight, uTime, uDusk, uSunUp;
        varying vec3 vDir;
        #include <logdepthbuf_pars_fragment>
        ${GLSL_NOISE}
        void main() {
          #include <logdepthbuf_fragment>
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), mix(0.42, 0.28, uDusk)));
          col = mix(col, uHorizon * 0.75, smoothstep(0.0, -0.25, h));
          float s = max(dot(d, uSunDir), 0.0);
          col += uSunColor * (pow(s, 900.0) * 1.2 * (1.0 - uDusk) + pow(s, 14.0) * 0.15 + pow(s, 3.0) * 0.05);
          // 노을 (참고: 한강 노을) — 상공 짙은 파랑, 중간 보라/자홍 구름, 지평선 황금빛 주황
          if (uDusk > 0.001) {
            float dh = clamp(1.0 - h * 2.2, 0.0, 1.0);
            vec2 sh = normalize(uSunDir.xz + 1e-4), dxz = normalize(d.xz + 1e-4);
            float toward = max(dot(sh, dxz), 0.0);
            // 중간 고도 보라빛 층
            float midBand = smoothstep(0.06, 0.22, h) * (1.0 - smoothstep(0.28, 0.6, h));
            col = mix(col, vec3(0.30, 0.14, 0.48), midBand * 0.6 * uDusk * (1.0 - uSunUp));
            // 지평선 황금빛 + 태양 방향 밝은 띠
            vec3 glow = mix(vec3(0.9, 0.28, 0.12), vec3(1.0, 0.40, 0.04), pow(toward, 1.5));
            col += glow * pow(dh, 2.2) * (0.10 + 0.40 * pow(toward, 2.0)) * uDusk;
            col += vec3(1.0, 0.55, 0.10) * pow(toward, 6.0) * pow(dh, 2.5) * 0.35 * uDusk;
            // 구름 띠 (두 층): 아래쪽은 주황빛, 위쪽은 자홍/보라
            float az = atan(d.x, d.z);
            float c1 = snoise(vec2(az * 2.2, h * 18.0)) * 0.5 + 0.5;
            float c2 = snoise(vec2(az * 6.0 + 3.0, h * 55.0)) * 0.5 + 0.5;
            float cl = smoothstep(0.40, 0.75, c1 * 0.7 + c2 * 0.3) * smoothstep(0.02, 0.07, h) * (1.0 - smoothstep(0.32, 0.55, h));
            cl *= smoothstep(0.03, 0.12, acos(clamp(s, -1.0, 1.0))); // 태양 주변은 구름 없이
            float low = 1.0 - smoothstep(0.05, 0.3, h);
            vec3 cloud = mix(vec3(0.40, 0.14, 0.45), vec3(1.0, 0.48, 0.12), low * (0.4 + 0.6 * toward));
            cloud = mix(cloud, vec3(0.18, 0.10, 0.34), (1.0 - low) * 0.6);
            col = mix(col, cloud, cl * (0.8 - 0.5 * uSunUp) * uDusk);
          }
          // 태양 주변: 넓게 퍼지는 황금빛 글레어 + 오렌지 무리 (원반 자체는 아래에서 밝게 그림)
          {
            float ang = acos(clamp(s, -1.0, 1.0));
            float g = uDusk * uSunUp;
            col += vec3(1.0, 0.92, 0.70) * exp(-ang * 4.5) * 0.9 * g;   // 넓은 백색 글레어
            col += vec3(1.0, 0.75, 0.35) * exp(-ang * 12.0) * 0.6 * g;  // 황금빛
            col += vec3(1.0, 0.42, 0.08) * exp(-ang * 28.0) * 0.5 * g;  // 오렌지 코어
            // 작은 흰 구름 (상공, 드문드문)
            float az = atan(d.x, d.z);
            float pc = snoise(vec2(az * 5.0 + 11.0, h * 9.0)) * 0.6 + snoise(vec2(az * 14.0, h * 26.0 + 5.0)) * 0.4;
            float puff = smoothstep(0.55, 0.8, pc * 0.5 + 0.5) * smoothstep(0.12, 0.3, h) * (1.0 - smoothstep(0.75, 0.95, h));
            vec3 puffCol = mix(vec3(0.95, 0.85, 0.80), vec3(1.0, 0.95, 0.9), s) * (0.9 + 0.3 * exp(-ang * 3.0));
            col = mix(col, puffCol, puff * 0.85 * g);
          }
          // 노을 채도 강화 (회색빛으로 바래지 않도록)
          { float lum = dot(col, vec3(0.3, 0.59, 0.11)); col = mix(vec3(lum), col, 1.0 + 0.45 * uDusk); col = max(col, 0.0); }
          { float mx = max(col.r, max(col.g, col.b)); if (mx > 1.0) col *= 1.0 / mx; } // 색 비율 유지하며 블룸 임계값 아래로
          // 태양 원반: 밝게 빛나는 흰빛 (HDR → 블룸으로 번짐)
          {
            float ang = acos(clamp(s, -1.0, 1.0));
            float disc = 1.0 - smoothstep(0.0125, 0.0145, ang);
            col = mix(col, vec3(1.0, 0.92, 0.75) * 2.8, disc * uDusk * uSunUp);
          }
          // 별: 셀마다 둥근 점광 + 반짝임
          {
            vec3 p = d * 230.0;
            vec3 cell = floor(p);
            float hs = hash31(cell);
            if (hs > 0.978) {
              vec3 sp = cell + 0.5 + (vec3(hash31(cell + 1.0), hash31(cell + 2.0), hash31(cell + 3.0)) - 0.5) * 0.6;
              float dd = length(p - sp);
              float size = 0.05 + 0.07 * hash31(cell + 4.0);
              float tw = 0.7 + 0.3 * sin(uTime * (1.5 + 3.0 * hs) + hs * 40.0);
              float star = exp(-dd * dd / (size * size)) * tw * (0.4 + 0.6 * hash31(cell + 5.0));
              vec3 tint = mix(vec3(0.85, 0.9, 1.0), vec3(1.0, 0.92, 0.8), hash31(cell + 6.0));
              col += tint * star * 1.6 * uNight * smoothstep(0.02, 0.25, h);
            }
          }
          // 달: 부드러운 원반 + 표면 명암 + 은은한 무리
          {
            float cosA = dot(d, uMoonDir);
            float ang = acos(clamp(cosA, -1.0, 1.0));
            float R = 0.012;
            float disc = 1.0 - smoothstep(R * 0.92, R, ang);
            vec3 T = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
            vec3 B = cross(T, uMoonDir);
            vec2 uv = vec2(dot(d, T), dot(d, B)) / R;
            float surf = 0.78 + 0.22 * snoise(uv * 2.5 + 3.0) * 0.5 + 0.1 * snoise(uv * 6.0);
            float limb = 1.0 - 0.35 * smoothstep(0.5, 1.0, length(uv));
            float moonVis = smoothstep(-0.08, 0.06, uMoonDir.y) * (0.25 + 0.75 * uNight);
            col = mix(col, vec3(0.95, 0.95, 0.9) * surf * limb * 1.6, disc * moonVis);
            col += vec3(0.6, 0.65, 0.8) * exp(-ang * 45.0) * 0.25 * moonVis * (1.0 - disc);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(45000, 48, 24), mat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);
    this._c = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
    this.elevation = 1;
  }

  update(hour, camera) {
    const th = ((hour - 6) / 12) * Math.PI;
    const dir = this.U.uSunDir.value.set(Math.cos(th), Math.sin(th) * 0.85, 0.4).normalize();
    const el = dir.y;
    this.elevation = el;
    const s = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const dayF = s(0.05, 0.35, el), duskF = s(-0.15, 0.02, el), night = 1 - s(-0.08, 0.1, el);
    const [c0, c1, c2] = this._c;

    this.U.uNight.value = night;
    this.uniforms.uDusk.value = Math.exp(-(el / 0.13) * (el / 0.13));
    const sunUp = s(-0.015, 0.05, el); // 해가 지평선 위에 보이는 노을(연무 낀 주황) vs 해 진 뒤(보라·파랑)
    this.uniforms.uSunUp.value = sunUp;
    this.uniforms.uSunColor.value.setRGB(1.0, 0.36, 0.12).lerp(c0.setRGB(1.0, 0.97, 0.92), s(0.0, 0.45, el));
    // 수평선 / 천정 색
    c1.setRGB(1.0, 0.36, 0.05).lerp(c0.setRGB(0.80, 0.86, 0.93), dayF);
    this.uniforms.uHorizon.value.setRGB(0.012, 0.014, 0.028).lerp(c1, duskF);
    // 상공: 해가 떠 있는 노을은 연어빛 분홍(연무), 해 진 뒤는 짙은 파랑
    const lowSun = 1 - s(0.02, 0.10, el); // 해가 지평선에 붙었을 때만 연어빛, 조금 높으면 파란 상공
    c2.setRGB(0.04, 0.10, 0.40).lerp(c1.setRGB(0.98, 0.48, 0.34), sunUp * this.uniforms.uDusk.value * lowSun);
    c1.copy(c2).lerp(c0.setRGB(0.30, 0.52, 0.90), Math.max(dayF, s(0.03, 0.14, el) * 0.85));
    this.uniforms.uTop.value.setRGB(0.003, 0.004, 0.012).lerp(c1, duskF);
    this.fog.color.copy(this.uniforms.uHorizon.value).lerp(c2.setRGB(1.0, 0.72, 0.38), 0.5 * this.uniforms.uDusk.value * sunUp); // 황금빛 연무
    this.fog.density = 0.000034 - 0.000014 * night + 0.00005 * this.uniforms.uDusk.value * sunUp; // 노을 연무
    this.U.uSkyColor.value.copy(this.uniforms.uHorizon.value).lerp(this.uniforms.uTop.value, 0.4);

    // 달: 태양 반대편 방위, 지평선 위 낮은 고도 (위성 시점에서도 기울이면 보이도록)
    this.uniforms.uMoonDir.value.set(-dir.x, 0.0, -dir.z).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
    this.uniforms.uMoonDir.value.y = 0.22 + 0.1 * night; this.uniforms.uMoonDir.value.normalize();
    if (this.moon) { this.moon.position.copy(this.uniforms.uMoonDir.value).multiplyScalar(5000); this.moon.intensity = 0.35 * night * s(-0.05, 0.1, this.uniforms.uMoonDir.value.y); }
    this.sun.color.copy(this.uniforms.uSunColor.value);
    this.sun.intensity = 3.4 * s(-0.06, 0.12, el);
    this.sun.castShadow = el > 0.04;
    c1.setRGB(0.95, 0.55, 0.38).lerp(c0.setRGB(0.68, 0.76, 0.92), dayF);
    this.hemi.color.setRGB(0.10, 0.09, 0.12).lerp(c1, duskF);
    this.hemi.groundColor.setRGB(0.05, 0.045, 0.04).lerp(c2.setRGB(0.55, 0.45, 0.32), duskF);
    this.hemi.intensity = 0.35 + 0.55 * s(-0.1, 0.25, el);
    this.baseExposure = (0.95 + 0.1 * night) * (1.0 - 0.22 * this.uniforms.uDusk.value); // main 에서 자동 노출과 곱해 적용
    this.dome.position.copy(camera.position);
  }
}
