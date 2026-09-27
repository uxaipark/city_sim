import { PCFShadowMap, REVISION } from 'three';

// Three r186 stores PCF shadows in a native depth texture. Seed the regular
// shadow target with cached static depth, then let Three draw dynamic casters
// using its normal depth test. PCF still filters ONE combined depth map.
// This narrow adapter deliberately falls back for other shadow implementations.
export class StaticShadowCache {
  constructor(renderer, light, staticObjects) {
    this.renderer = renderer;
    this.light = light;
    this.staticObjects = staticObjects;
    this.staticSet = new Set(staticObjects);
    this.enabled = true;
    this.valid = false;
    this.stableFrames = 0;
    this.signature = [];
    this.map = null;
    this.stats = { hits: 0, builds: 0, bypasses: 0 };
    this.originalRender = renderer.shadowMap.render;
    this.wrapper = (lights, scene, camera) => this.render(lights, scene, camera);
    renderer.shadowMap.render = this.wrapper;
    this.onContextRestored = () => { this.release(); this.invalidate(); };
    renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  invalidate() { this.valid = false; this.stableFrames = 0; this.signature.length = 0; }
  release() {
    if (this.map) { this.map.depthTexture?.dispose(); this.map.dispose(); this.map = null; }
  }
  dispose() {
    if (this.renderer.shadowMap.render === this.wrapper) this.renderer.shadowMap.render = this.originalRender;
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.release();
  }

  unchanged(camera) {
    let index = 0, same = true;
    const check = value => {
      if (this.signature[index] !== value) same = false;
      this.signature[index++] = value;
    };
    const { light } = this, shadow = light.shadow;
    check(camera.layers.mask); check(shadow.mapSize.x); check(shadow.mapSize.y);
    for (const matrix of [light.matrixWorld, light.target.matrixWorld, shadow.camera.projectionMatrix]) {
      for (const value of matrix.elements) check(value);
    }
    for (const object of this.staticObjects) {
      let visible = true;
      for (let parent = object; parent; parent = parent.parent) visible &&= parent.visible;
      check(visible); check(object.castShadow); check(object.layers.mask); check(object.frustumCulled);
      check(object.count); check(object.instanceMatrix?.version);
      for (const value of object.matrixWorld.elements) check(value);
      const geometry = object.geometry;
      check(geometry.id); check(geometry.index?.version);
      check(geometry.drawRange.start); check(geometry.drawRange.count);
      for (const attr of Object.values(geometry.attributes)) check(attr.version);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        check(material.id); check(material.version); check(material.visible);
        check(material.side); check(material.shadowSide); check(material.alphaTest);
        check(material.map?.id); check(material.map?.version);
        check(material.alphaMap?.id); check(material.alphaMap?.version);
      }
    }
    if (index !== this.signature.length) same = false;
    this.signature.length = index;
    return same;
  }

  render(lights, scene, camera) {
    const renderer = this.renderer, manager = renderer.shadowMap, shadow = this.light.shadow;
    const normal = () => this.originalRender.call(manager, lights, scene, camera);
    // Respect exposure renders, the shadows toggle, and diagnostic exclusions.
    // Bloom/output passes also invoke the shadow manager with no lights. They
    // must not invalidate a cache belonging to the main city scene.
    if (!manager.enabled || lights.length === 0 || (!manager.autoUpdate && !manager.needsUpdate)) return normal();
    if (!this.enabled || REVISION !== '186' || manager.type !== PCFShadowMap ||
        renderer.capabilities.reversedDepthBuffer || !manager.autoUpdate || !shadow.autoUpdate ||
        lights.length !== 1 || lights[0] !== this.light || shadow.getViewportCount() !== 1) {
      this.invalidate(); this.stats.bypasses++;
      return normal();
    }
    if (!this.unchanged(camera)) { this.valid = false; this.stableFrames = 0; }
    // Don't rebuild a 4096² cache every frame while panning or advancing time.
    if (++this.stableFrames < 3) { this.stats.bypasses++; return normal(); }

    if (!this.valid) {
      const combinedMap = shadow.map, hidden = [];
      scene.traverse(object => {
        if (object.castShadow && !object.isLight && !this.staticSet.has(object)) {
          hidden.push(object); object.castShadow = false;
        }
      });
      shadow.map = this.map;
      try {
        normal();
        this.map = shadow.map;
        this.valid = true; this.stats.builds++;
      } finally {
        shadow.map = combinedMap;
        for (const object of hidden) object.castShadow = true;
      }
    }

    const flags = this.staticObjects.map(object => object.castShadow);
    const clear = renderer.clear;
    for (const object of this.staticObjects) object.castShadow = false;
    renderer.clear = (...args) => {
      clear.apply(renderer, args);
      const target = renderer.getRenderTarget();
      if (target === shadow.map && target?.depthTexture && args[1] !== false) {
        renderer.copyTextureToTexture(this.map.depthTexture, target.depthTexture);
        // copyTextureToTexture unbinds its read/draw framebuffers.
        renderer.setRenderTarget(target);
      }
    };
    try { normal(); this.stats.hits++; }
    finally {
      renderer.clear = clear;
      this.staticObjects.forEach((object, i) => { object.castShadow = flags[i]; });
    }
  }
}
