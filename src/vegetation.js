// 나무 (활엽수 / 야자수) 인스턴싱 + 바람 흔들림 셰이더
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';

import { TREE_SPECIES } from './tree-species.js';

export function treeGeometry(kind) {
  const { h, r, shape } = TREE_SPECIES[kind];
  const palm = shape === 'palm';
  const trunkH = palm ? h * 0.88 : h * 0.48;
  const trunk = new THREE.CylinderGeometry(palm ? 0.18 : 0.22, palm ? 0.34 : 0.42, trunkH, 6).toNonIndexed();
  trunk.translate(0, trunkH / 2, 0);
  const parts = [trunk];
  if (shape === 'cone') {
    for (let i = 0; i < 3; i++) {
      const crown = new THREE.ConeGeometry(r * (1 - i * 0.22), h * 0.48, 8).toNonIndexed();
      crown.translate(0, h * (0.38 + i * 0.19), 0); parts.push(crown);
    }
  } else if (palm) {
    // Eight radial fronds give palms a distinct silhouette.
    for (let i = 0; i < 8; i++) {
      const frond = new THREE.IcosahedronGeometry(1, 0);
      frond.scale(r * 0.62, 0.22, 0.65);
      frond.rotateZ(-0.15); frond.translate(r * 0.46, trunkH, 0);
      frond.rotateY(i * Math.PI / 4); parts.push(frond);
    }
  } else {
    const crown = new THREE.IcosahedronGeometry(1, 1);
    const ry = shape === 'column' ? h * 0.43 : shape === 'oval' ? h * 0.36 : shape === 'wide' ? h * 0.25 : h * 0.34;
    crown.scale(r, ry, r * (shape === 'weeping' ? 0.95 : 0.87));
    crown.translate(0, h - ry, 0); parts.push(crown);
  }
  parts.forEach((part, i) => part.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(part.attributes.position.count).fill(i ? 1 : 0), 1)));
  const result = mergeGeometries(parts);
  parts.forEach((part) => part.dispose());
  // Reuse identical vertices (position, normal, UV and part all participate).
  // Triangle topology and shading stay intact while vertex shader work decreases.
  const indexed = mergeVertices(result);
  indexed.userData.unindexedVertices = result.attributes.position.count;
  result.dispose();
  return indexed;
}

export function buildTrees(city, U) {
  const group = new THREE.Group();
  const rng = mulberry32(99);
  const speciesBatches = [];
  // Spatial batches share geometry/materials with a single full-city batch.
  // Choose the cheaper representation without changing any tree or its detail.
  const byKind = Array.from({ length: TREE_SPECIES.length }, () => []);
  for (const tree of city.trees) byKind[tree.kind].push(tree);
  for (let kind = 0; kind < TREE_SPECIES.length; kind++) {
    const list = byKind[kind];
    if (!list.length) continue;
    const geo = treeGeometry(kind);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    const cells = new Map();
    list.forEach((t, k) => {
      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      dummy.scale.setScalar(t.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
      color.setHex(TREE_SPECIES[kind].color).multiplyScalar(0.85 + rng() * 0.3);
      mesh.setColorAt(k, color);
      const cellKey = `${Math.floor(t.x / 1536)},${Math.floor(t.z / 1536)}`;
      if (!cells.has(cellKey)) cells.set(cellKey, []);
      cells.get(cellKey).push(k);
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
    mesh.computeBoundingSphere();
    // Include shader wind displacement in the CPU culling bound.
    mesh.boundingSphere.radius += 2;
    mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
    mesh.userData.kind = kind;
    const chunks = new THREE.Group();
    for (const ids of cells.values()) {
      const chunk = new THREE.InstancedMesh(geo, mat, ids.length);
      const matrixArray = chunk.instanceMatrix.array;
      const colors = new Float32Array(ids.length * 3);
      ids.forEach((id, i) => {
        matrixArray.set(mesh.instanceMatrix.array.subarray(id * 16, id * 16 + 16), i * 16);
        colors.set(mesh.instanceColor.array.subarray(id * 3, id * 3 + 3), i * 3);
      });
      chunk.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      chunk.castShadow = chunk.receiveShadow = true;
      chunk.computeBoundingSphere(); chunk.boundingSphere.radius += 2;
      chunk.updateMatrix(); chunk.matrixAutoUpdate = false;
      chunk.userData.kind = kind;
      chunk.userData.sourceIds = Uint32Array.from(ids);
      chunks.add(chunk);
    }
    chunks.visible = false;
    group.add(mesh, chunks);
    speciesBatches.push({ full: mesh, chunks });
  }
  group.userData.species = TREE_SPECIES.map((s) => s.name);
  group.userData.count = city.trees.length;
  group.userData.batches = speciesBatches;
  const view = new THREE.Frustum(), matrix = new THREE.Matrix4();
  group.userData.update = (camera, sun) => {
    camera.updateMatrixWorld();
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    view.setFromProjectionMatrix(matrix);
    let shadow;
    if (sun?.castShadow) {
      sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
      sun.shadow.updateMatrices(sun);
      shadow = sun.shadow.getFrustum();
    }
    let submitted = 0, draws = 0;
    for (const { full, chunks } of speciesBatches) {
      const fullPasses = Number(view.intersectsSphere(full.boundingSphere)) + Number(!!shadow && shadow.intersectsSphere(full.boundingSphere));
      const fullCost = full.count * fullPasses;
      let chunkCost = 0, chunkDraws = 0;
      for (const chunk of chunks.children) {
        const passes = Number(view.intersectsSphere(chunk.boundingSphere)) + Number(!!shadow && shadow.intersectsSphere(chunk.boundingSphere));
        chunkCost += chunk.count * passes; chunkDraws += passes;
      }
      // Avoid hundreds of extra draw calls when viewing most of the city.
      const split = chunkCost < fullCost * 0.65;
      full.visible = !split; chunks.visible = split;
      submitted += split ? chunkCost : fullCost;
      draws += split ? chunkDraws : fullPasses;
    }
    group.userData.submittedInstances = submitted;
    group.userData.draws = draws;
  };
  return group;
}
