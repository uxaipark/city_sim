import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Composer always supplies physical pixels. Keep the wide halo at half that size,
// including after resizing, and retain the previous screen-space blur footprint.
export class SizedBloomPass extends UnrealBloomPass {
  constructor(resolution, strength, radius, threshold, resolutionScale = 1, pixelRatio = 1) {
    super(resolution, strength, radius, threshold);
    this.resolutionScale = resolutionScale;
    this.pixelRatio = pixelRatio;
  }

  setSize(width, height) {
    super.setSize(Math.max(2, Math.round(width * this.resolutionScale)), Math.max(2, Math.round(height * this.resolutionScale)));
    for (const material of this.separableBlurMaterials) {
      material.uniforms.invSize.value.multiplyScalar(this.resolutionScale / this.pixelRatio);
    }
  }
}
