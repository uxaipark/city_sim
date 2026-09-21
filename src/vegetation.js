// 나무 (활엽수 / 야자수) 인스턴싱 + 바람 흔들림 셰이더
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';

function treeGeometry(kind) {
  let trunk, canopy;
  if (kind === 0) {
    trunk = new THREE.CylinderGeometry(0.22, 0.4, 3.2, 6).toNonIndexed(); trunk.translate(0, 1.6, 0);
    canopy = new THREE.IcosahedronGeometry(2.7, 1); canopy.scale(1, 1.2, 1); canopy.translate(0, 4.9, 0);
  } else {
    trunk = new THREE.CylinderGeometry(0.18, 0.34, 7.5, 6).toNonIndexed(); trunk.translate(0, 3.75, 0);
    canopy = new THREE.IcosahedronGeometry(3.4, 1); canopy.scale(1, 0.32, 1); canopy.translate(0, 7.6, 0);
  }
  trunk.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(trunk.attributes.position.count), 1));
  canopy.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(canopy.attributes.position.count).fill(1), 1));
  return mergeGeometries([trunk, canopy]);
}

const CANOPY = [
  [[0.30, 0.52, 0.20], [0.40, 0.60, 0.22], [0.24, 0.45, 0.18], [0.50, 0.62, 0.20], [0.35, 0.50, 0.25]],
  [[0.28, 0.48, 0.18], [0.36, 0.55, 0.20], [0.22, 0.42, 0.16]],
];

export function buildTrees(city, U) {
  const group = new THREE.Group();
  const rng = mulberry32(99);
  for (let kind = 0; kind < 2; kind++) {
    const list = city.trees.filter((t) => t.kind === kind);
    if (!list.length) continue;
    const geo = treeGeometry(kind);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    list.forEach((t, k) => {
      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      dummy.scale.setScalar(t.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
      const c = CANOPY[kind][Math.floor(rng() * CANOPY[kind].length)];
      mesh.setColorAt(k, color.setRGB(c[0] + (rng() - 0.5) * 0.08, c[1] + (rng() - 0.5) * 0.08, c[2] + (rng() - 0.5) * 0.06));
    });
    mesh.castShadow = true; mesh.receiveShadow = true;
    mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = U.uTime;
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPart; varying float vPart; uniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vPart = aPart;
          { float ph = dot(instanceMatrix[3].xz, vec2(0.37, 0.53));
            transformed.xz += vec2(sin(uTime * 1.3 + ph), cos(uTime * 0.9 + ph)) * 0.035 * aPart * transformed.y; }`);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vPart;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb = mix(vec3(0.36, 0.25, 0.15), vColor.rgb, vPart);`);
    };
    mat.customProgramCacheKey = () => 'trees';
    group.add(mesh);
  }
  return group;
}
