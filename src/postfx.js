// Post-processing stack — the modern-game polish layer.
// RenderPass -> UnrealBloom (emissives glow) -> linear color-grade + vignette
// -> OutputPass (ACES tone map + sRGB) -> SMAA/FXAA (a composer bypasses the
// renderer's MSAA, so we must anti-alias ourselves). Tiered for phone GPUs.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// Gentle cinematic grade in LINEAR space (runs after bloom, before tone map):
// a touch of contrast + saturation, a soft vignette, and ordered dithering to
// kill sky/fog banding. Cheap single full-screen pass.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: 0.32 },
    contrast: { value: 1.06 },
    saturation: { value: 1.08 },
    lift: { value: 0.008 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float vignette, contrast, saturation, lift;
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb;
      // saturation around luma
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);
      // contrast + shadow lift, pivoted at mid grey
      c = (c - 0.5) * contrast + 0.5 + lift;
      // soft radial vignette
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.35, dot(d, d) * 2.0);
      c *= mix(1.0 - vignette, 1.0, v);
      // ordered dither (± ~1/255) to break gradients before 8-bit output
      float dth = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      c += (dth - 0.5) / 255.0;
      gl_FragColor = vec4(max(c, 0.0), tex.a);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.enabled = true;
    // tier down effects for phone GPUs / small screens
    const mobile = (navigator.maxTouchPoints > 0) || Math.min(window.innerWidth, window.innerHeight) < 500;
    this.mobile = mobile;

    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);

    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      mobile ? 0.42 : 0.62,   // strength
      mobile ? 0.5 : 0.55,    // radius
      0.72                    // threshold — only highlights/emissives bloom
    );
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    if (mobile) this.grade.uniforms.vignette.value = 0.24;
    this.composer.addPass(this.grade);

    this.composer.addPass(new OutputPass());

    // anti-alias last, on the final image. SMAA on desktop, cheaper FXAA on phones.
    if (mobile) {
      this.fxaa = new ShaderPass(FXAAShader);
      this.composer.addPass(this.fxaa);
    } else {
      this.smaa = new SMAAPass(size.x, size.y);
      this.composer.addPass(this.smaa);
    }
    this.setSize(size.x, size.y);
  }

  setCamera(camera) {
    for (const p of this.composer.passes) if (p.camera !== undefined) p.camera = camera;
  }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    if (this.smaa) this.smaa.setSize(w * pr, h * pr);
    if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
  }

  render() {
    if (this.enabled) this.composer.render();
    else this.renderer.render(this.composer.passes[0].scene, this.composer.passes[0].camera);
  }
}
