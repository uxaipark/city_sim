// Open /?verify=shadows. Runs against the actual city and renderer, with frozen
// simulation state while each cached/uncached pair is rendered and compared.
import * as THREE from 'three';

export async function verifyShadows(api) {
  const { renderer, scene, camera, controls, sky, traffic, people, signals, trees, shadowCache, U } = api;
  const light = shadowCache.light, target = new THREE.WebGLRenderTarget(672, 418);
  const a = new Uint8Array(672 * 418 * 4), b = new Uint8Array(a.length);
  const results = [], savedPosition = camera.position.clone(), savedTarget = controls.target.clone();
  const originalStatic = shadowCache.staticObjects[0];
  const savedStaticPosition = originalStatic.position.clone();
  const prepare = (hour, close) => {
    camera.position.set(...(close ? [500, 200, -800] : [1600, 5400, 5600]));
    controls.target.set(...(close ? [500, 0, -1100] : [200, 0, 0]));
    camera.lookAt(controls.target); camera.updateMatrixWorld();
    sky.update(hour, camera);
    light.castShadow = sky.elevation > .04;
    light.target.position.copy(controls.target);
    light.position.copy(controls.target).addScaledVector(U.uSunDir.value, 5000);
    light.target.updateMatrixWorld();
    const extent = Math.min(4200, Math.max(220, camera.position.distanceTo(controls.target) * 1.3));
    Object.assign(light.shadow.camera, { left:-extent, right:extent, top:extent, bottom:-extent });
    light.shadow.camera.updateProjectionMatrix();
    trees.userData.update(camera, light);
  };
  const emptyScene = new THREE.Scene();
  const render = () => {
    renderer.setRenderTarget(target);
    // Postprocessing renders scenes without lights between city frames.
    renderer.render(emptyScene, camera);
    renderer.render(scene, camera);
  };
  const compare = name => {
    renderer.info.autoReset = false;
    renderer.info.reset(); render();
    const cachedDraws = renderer.info.render.calls;
    renderer.readRenderTargetPixels(target, 0, 0, 672, 418, a);
    shadowCache.enabled = false;
    renderer.info.reset(); render();
    const originalDraws = renderer.info.render.calls;
    renderer.readRenderTargetPixels(target, 0, 0, 672, 418, b);
    let different = 0, maxDifference = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) different++;
      maxDifference = Math.max(maxDifference, Math.abs(a[i] - b[i]));
    }
    results.push({ name, differentChannels:different, maxDifference, cachedDraws, originalDraws, cache:{...shadowCache.stats} });
    if (different) throw new Error(`${name}: ${different} channels differ, max ${maxDifference}`);
    if (name === 'home-cache-hit') {
      if (cachedDraws >= originalDraws) throw new Error('Cache did not eliminate static shadow draws');
      light.castShadow = false; render();
      renderer.readRenderTargetPixels(target, 0, 0, 672, 418, b);
      light.castShadow = true;
      if (a.every((value, i) => value === b[i])) throw new Error('Test scene has no visible shadow contribution');
    }
    shadowCache.enabled = true;
    render(); render(); render();
  };
  try {
    traffic.setDensity(.7, .65); people.setDensity(.7);
    signals.update(10); traffic.update(1/60, 10, people.nodeCross);
    prepare(15, false);
    shadowCache.enabled = true; render(); render(); render();
    compare('home-cache-hit');
    traffic.update(.05, 10.05, people.nodeCross); U.uTime.value += .05;
    compare('moving-vehicles-and-wind');
    prepare(15, true); compare('camera-change-immediate');
    compare('close-cache-hit');
    originalStatic.visible = false; compare('static-caster-hidden');
    originalStatic.visible = true; compare('static-caster-restored');
    originalStatic.position.x += 1; compare('static-transform-changed');
    originalStatic.position.x -= 1;
    prepare(17.55, true); compare('sun-change');
    light.shadow.mapSize.set(2048, 2048); compare('shadow-resize');
    light.shadow.mapSize.set(4096, 4096);
    prepare(22, true); compare('night');
    prepare(15, true); compare('day-restored');
    renderer.shadowMap.enabled = false; compare('shadows-disabled');
    renderer.shadowMap.enabled = true; compare('shadows-restored');
    const error = renderer.getContext().getError();
    if (error) throw new Error(`WebGL error: ${error}`);
    console.log('SHADOW_CHECK', JSON.stringify({pass:true, results}));
    return {pass:true, results};
  } catch (error) {
    console.error(error);
    return {pass:false, error:String(error), results};
  } finally {
    renderer.info.autoReset = true; renderer.shadowMap.enabled = true;
    originalStatic.visible = true;
    originalStatic.position.copy(savedStaticPosition);
    light.shadow.mapSize.set(4096, 4096);
    shadowCache.enabled = true; shadowCache.invalidate();
    renderer.setRenderTarget(null); target.dispose();
    camera.position.copy(savedPosition); controls.target.copy(savedTarget); controls.update();
    sky.lastHour = undefined;
  }
}
