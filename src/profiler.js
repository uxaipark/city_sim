// Opt-in diagnostic instrumentation. Only installed with ?profile=1.
// Effect exclusions are measurement experiments, never production quality settings.
export function installProfiler(api) {
  const { renderer, composer, camera, controls, passes, people, scene } = api;
  const warmupFrames = Math.min(1200, Math.max(60, Number(new URLSearchParams(location.search).get('warmup')) || 60));
  const totalFrames = warmupFrames + 120;
  const gl = renderer.getContext();
  const availableTimer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const ext = new URLSearchParams(location.search).get('profile') === 'gpu' ? availableTimer : null;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const trees = scene.children.find(o => o.userData.species);
  const buildings = scene.children.find(o => o.userData.interior);
  const original = composer.passes.map(p => p.enabled);
  const originalShadow = renderer.shadowMap.enabled;
  const originalAutoReset = renderer.info.autoReset;
  const restoreFunctions = [];
  const records = [];
  let current, phase = -1, frame = 0, recording = false, started = 0, gpuBusy = false, done = false, queryIssued = false;
  const pending = [];
  const stats = values => {
    if (!values?.length) return null;
    const sorted = [...values].sort((a,b) => a-b);
    return { n: values.length, mean: values.reduce((a,b) => a+b,0)/values.length,
      median: sorted[Math.floor(sorted.length/2)], p95: sorted[Math.min(sorted.length-1, Math.floor(sorted.length*.95))] };
  };
  const add = (bucket, name, value, target = current) => (target[bucket][name] ||= []).push(value);
  function wrap(obj, key, name, gpu = false) {
    const originalFunction = obj[key];
    obj[key] = function(...args) {
      const start = performance.now();
      let query;
      if (recording && gpu && ext && !gpuBusy && !queryIssued && name === timedPasses[frame % timedPasses.length]) {
        query = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, query); gpuBusy = true; queryIssued = true;
      }
      try { return originalFunction.apply(this, args); }
      finally {
        if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); gpuBusy = false; pending.push({ query, name, target: current }); }
        if (recording) add('cpu', name, performance.now() - start);
      }
    };
    restoreFunctions.push(() => { obj[key] = originalFunction; });
  }
  for (const [obj, key, name] of [
    [api.signals,'update','signals'], [people,'update','pedestrianSimulation'],
    [people,'updateRender','pedestrianCullingAndPacking'], [api.traffic,'update','traffic'],
    [api.subway,'update','subway'], [api.sky,'update','sky'],
    [renderer.shadowMap,'render','shadowSubmission'],
  ]) wrap(obj,key,name);
  const timedPasses = ['sceneWithShadows','bloom','bloomWide','streak','output','vignette'];
  const names = ['sceneWithShadows','bloom','bloomWide','streak','afterimage','output','tilt','vignette'];
  composer.passes.forEach((p,i) => wrap(p,'render',names[i],true));
  // The exposure scene render is identified by its 24x24 target.
  const render = renderer.render;
  renderer.render = function(...args) {
    const target = renderer.getRenderTarget();
    if (target?.width !== 24 || target.height !== 24) return render.apply(this,args);
    const start = performance.now();
    let query;
    if (recording && ext && !gpuBusy && !queryIssued) { query = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT,query); gpuBusy = true; queryIssued = true; }
    try { return render.apply(this,args); }
    finally {
      if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); gpuBusy = false; pending.push({query,name:'exposureScene',target:current}); }
      if (recording) add('cpu','exposureScene',performance.now()-start);
    }
  };
  restoreFunctions.push(() => { renderer.render = render; });
  let scenarios = [
    { name:'day-home-baseline' },
    { name:'day-home-no-streak', off:['streak'] },
    { name:'day-home-no-bloom', off:['bloom','bloomWide'] },
    { name:'day-home-bloom-native-size', nativeBloom:true },
    { name:'day-home-no-shadows', shadows:false },
    { name:'day-home-no-trees', trees:false },
    { name:'day-home-no-postfx', off:['bloom','bloomWide','streak','grain'] },
    { name:'day-home-baseline-repeat' },
    { name:'day-close-baseline', close:true },
    { name:'day-close-no-pedestrians', close:true, pedestrians:false },
    { name:'night-home-baseline', hour:22 },
    { name:'night-home-no-streak', hour:22, off:['streak'] },
    { name:'night-home-no-bloom', hour:22, off:['bloom','bloomWide'] },
  ];
  if (new URLSearchParams(location.search).get('profile') === 'compare') {
    scenarios = scenarios.filter(s => ['day-home-baseline','day-home-baseline-repeat','day-close-baseline','night-home-baseline'].includes(s.name));
  }
  if (api.trees) wrap(api.trees.userData, 'update', 'treeCulling');
  const badge = document.createElement('div');
  badge.style.cssText = 'position:fixed;bottom:70px;left:20px;z-index:10000;background:#152136;color:white;padding:12px;font:14px monospace;pointer-events:none';
  document.body.append(badge);
  const cycles = Math.min(3, Math.max(1, Number(new URLSearchParams(location.search).get('cycles')) || 1));
  const oneCycle = scenarios.slice();
  for (let i = 1; i < cycles; i++) scenarios.push(...oneCycle);
  function next() {
    if (current) current.complete = true;
    phase++;
    if (phase >= scenarios.length) { done = true; recording = false; finish(); return; }
    const config = scenarios[phase];
    composer.passes.forEach((p,i) => { p.enabled = original[i]; });
    for (const name of config.off || []) passes[name].enabled = false;
    renderer.shadowMap.enabled = config.shadows !== false;
    trees.visible = config.trees !== false; buildings.visible = config.buildings !== false;
    api.setHour(config.hour ?? 15);
    camera.position.set(...(config.close ? [500,200,-800] : [1600,5400,5600]));
    controls.target.set(...(config.close ? [500,0,-1100] : [200,0,0]));
    controls.update();
    const width = config.nativeBloom ? composer.renderTarget1.width : composer._width * composer._pixelRatio;
    const height = config.nativeBloom ? composer.renderTarget1.height : composer._height * composer._pixelRatio;
    passes.bloom.setSize(width,height); passes.bloomWide.setSize(width,height);
    current = { scenario: config.name, cpu:{},gpu:{},interval:[],frames:[],draws:[],triangles:[], peopleRendered:[], hiddenFrames:0 };
    records.push(current); frame = 0;
  }
  function poll() {
    const disjoint = ext && gl.getParameter(ext.GPU_DISJOINT_EXT);
    for (let i = pending.length-1; i >= 0; i--) {
      const item = pending[i];
      if (disjoint || gl.getQueryParameter(item.query,gl.QUERY_RESULT_AVAILABLE)) {
        if (!disjoint) add('gpu',item.name,gl.getQueryParameter(item.query,gl.QUERY_RESULT)/1e6,item.target);
        gl.deleteQuery(item.query); pending.splice(i,1);
      }
    }
  }
  const environment = {
    warmupFrames, cycles, runId:performance.timeOrigin, userAgent:navigator.userAgent, cpuThreads:navigator.hardwareConcurrency,
    renderer:debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    gpuTimerSupported:!!availableTimer, gpuTimersEnabled:!!ext, cssSize:[innerWidth,innerHeight], dpr:devicePixelRatio,
    drawingBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],
    composerSize:[composer._width,composer._height], composerPixelRatio:composer._pixelRatio,
    targetSize:[composer.renderTarget1.width,composer.renderTarget1.height],
    bloomBrightSize:[passes.bloom.renderTargetBright.width,passes.bloom.renderTargetBright.height],
    bloomWideBrightSize:[passes.bloomWide.renderTargetBright.width,passes.bloomWide.renderTargetBright.height],
    msaa:composer.renderTarget1.samples,
  };
  let sent = 0;
  async function sendReady(force = false) {
    while (sent < records.length && (force || records[sent].complete)) {
      const r = records[sent];
      if (!force && pending.some(p => p.target === r)) return;
      if (!r.interval.length) return;
      const report = { environment, shadowCache:api.shadowCache ? {...api.shadowCache.stats} : null, scenario:r.scenario, fps:1000 / stats(r.interval).mean,
        frameMs:stats(r.interval), frameCpuMs:stats(r.frames),
        cpu:Object.fromEntries(Object.entries(r.cpu).map(([k,v]) => [k,stats(v)])),
        gpu:Object.fromEntries(Object.entries(r.gpu).map(([k,v]) => [k,stats(v)])),
        draws:stats(r.draws),triangles:stats(r.triangles),peopleRendered:stats(r.peopleRendered),hiddenFrames:r.hiddenFrames };
      sent++;
      window.__nomadProfile ||= []; window.__nomadProfile.push(report);
      try { await fetch('http://127.0.0.1:5174/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)}); }
      catch(error) { console.warn('Profile collector unavailable',error); }
    }
  }
  function finish() {
    const drain = () => {
      poll();
      if (pending.length) { setTimeout(drain,50); return; }
      void sendReady(true);
      restoreFunctions.reverse().forEach(fn => fn());
      renderer.info.autoReset = originalAutoReset;
      renderer.shadowMap.enabled = originalShadow;
      composer.passes.forEach((p,i) => {p.enabled = original[i];});
      trees.visible = buildings.visible = true;
      passes.bloom.setSize(composer._width * composer._pixelRatio,composer._height * composer._pixelRatio);
      passes.bloomWide.setSize(composer._width * composer._pixelRatio,composer._height * composer._pixelRatio);
      api.setHour(15);
      badge.textContent = '프로파일링 완료 · profiles/latest.json';
    };
    drain();
  }
  renderer.info.autoReset = false;
  next();
  return {
    beginFrame(elapsed) {
      if (done) return;
      poll(); void sendReady();
      frame++; queryIssued = false; recording = frame > warmupFrames;
      renderer.info.reset(); started = performance.now();
      if (recording) { current.interval.push(elapsed * 1000); if (document.hidden) current.hiddenFrames++; }
      badge.textContent = `프로파일링 ${phase+1}/${scenarios.length} · ${current.scenario} · ${frame}/${totalFrames}`;
    },
    endFrame() {
      if (done) return;
      if (scenarios[phase].pedestrians === false) people.mesh.visible = false;
      if (recording) {
        current.frames.push(performance.now()-started);
        current.draws.push(renderer.info.render.calls); current.triangles.push(renderer.info.render.triangles);
        current.peopleRendered.push(people.mesh.visible ? people.mesh.count : 0);
      }
      if (frame >= totalFrames) next();
    },
    beforeRender() { if (!done && scenarios[phase].pedestrians === false) people.mesh.visible = false; },
  };
}
