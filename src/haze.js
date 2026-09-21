// 지면 연무: 낮은 고도에 얇은 안개 층 (밤에 불빛이 부드럽게 번지도록)
import * as THREE from 'three';
import { WORLD } from './citygen.js';
import { GLSL_NOISE } from './glsl.js';

export function buildHaze(U) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uNight: U.uNight, uColor: { value: new THREE.Color(0.75, 0.62, 0.45) } },
    vertexShader: `varying vec2 vUv; varying vec3 vW;
#include <common>

#include <logdepthbuf_pars_vertex>
void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp;
#include <logdepthbuf_vertex>
}`,
    fragmentShader: `uniform float uTime, uNight; uniform vec3 uColor; varying vec2 vUv; varying vec3 vW;
#include <logdepthbuf_pars_fragment>
${GLSL_NOISE}
      void main(){
#include <logdepthbuf_fragment>
float n = snoise(vW.xz * 0.0009 + vec2(uTime * 0.004, 0.0)) * 0.5 + 0.5;
        float n2 = snoise(vW.xz * 0.004 - vec2(0.0, uTime * 0.01)) * 0.5 + 0.5;
        float a = smoothstep(0.45, 0.95, n * 0.7 + n2 * 0.3) * (0.03 + 0.06 * uNight);
        // 위에서 내려다볼 때는 얼룩처럼 보이므로 카메라가 낮을 때(거리뷰)만, 그리고 가까운 곳만 보이게
        a *= smoothstep(260.0, 60.0, cameraPosition.y) * smoothstep(1400.0, 200.0, distance(cameraPosition.xz, vW.xz));
        float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.x) * smoothstep(1.0, 0.92, vUv.y);
        gl_FragColor = vec4(mix(uColor, vec3(0.55, 0.55, 0.62), uNight), a * edge);
#include <tonemapping_fragment>

#include <colorspace_fragment>
}`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  for (const y of [5, 14, 26]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 0.42, WORLD * 0.42), mat);
    m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 5; m.frustumCulled = false;
    group.add(m);
  }
  return group;
}
