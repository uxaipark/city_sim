// 후처리 셰이더: 스타버스트 광선, 필름 그레인 + 비네팅, 틸트시프트
export const StreakShader = {
  uniforms: { tDiffuse: { value: null }, uTexel: { value: null }, uStrength: { value: 0.35 }, uThreshold: { value: 1.1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uStrength, uThreshold; varying vec2 vUv;
    vec3 bright(vec2 uv){ vec3 c = texture2D(tDiffuse, uv).rgb; float l = max(max(c.r, c.g), c.b); return c * max(l - uThreshold, 0.0) / max(l, 1e-3); }
    void main(){
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec3 acc = vec3(0.0);
      // 4방향(십자) 광선: 밝은 점광에서 가늘게 뻗는 별 모양
      for (int i = 1; i <= 14; i++) {
        float fi = float(i); float w = pow(0.78, fi) ;
        vec2 o = uTexel * fi * 2.2;
        acc += (bright(vUv + vec2(o.x, 0.0)) + bright(vUv - vec2(o.x, 0.0)) + bright(vUv + vec2(0.0, o.y)) + bright(vUv - vec2(0.0, o.y))) * w;
      }
      gl_FragColor = vec4(base + acc * uStrength * 0.25 * vec3(1.0, 0.95, 0.85), 1.0);
    }`,
};
export const GrainVignetteShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.03 }, uVignette: { value: 0.35 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette; varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float n = hash(vUv * 1000.0 + fract(uTime * 7.31) * 100.0) - 0.5;
      float lum = dot(c.rgb, vec3(0.3, 0.59, 0.11));
      c.rgb += n * uGrain * (0.6 + 0.8 * (1.0 - lum)); // 어두운 곳에서 그레인이 더 보이게
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.85);
      c.rgb *= 1.0 - uVignette * smoothstep(0.35, 0.95, length(d) * 1.4);
      gl_FragColor = c;
    }`,
};
export const TiltShiftShader = {
  uniforms: { tDiffuse: { value: null }, uTexel: { value: null }, uFocus: { value: 0.5 }, uRange: { value: 0.12 }, uAmount: { value: 1.0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uFocus, uRange, uAmount; varying vec2 vUv;
    void main(){
      float blur = smoothstep(uRange, uRange + 0.35, abs(vUv.y - uFocus)) * uAmount;
      if (blur < 0.01) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec4 acc = vec4(0.0); float wsum = 0.0;
      for (int i = -6; i <= 6; i++) for (int j = -6; j <= 6; j++) {
        vec2 o = vec2(float(i), float(j)) * uTexel * blur * 2.0;
        float w = exp(-(float(i*i + j*j)) / 18.0);
        acc += texture2D(tDiffuse, vUv + o) * w; wsum += w;
      }
      gl_FragColor = acc / wsum;
    }`,
};
