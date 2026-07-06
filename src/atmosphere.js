// Dynamic lighting & time-of-day atmosphere.
// One rig owns the sun/moon directional light, hemisphere + ambient fill,
// sky dome (with sun disc, moon and stars), fog color and tone-mapping
// exposure — all graded along a 0..1 day cycle (0 = midnight, 0.5 = noon).
// Also feeds a PMREM environment map from the sky so PBR materials
// (the glass balls especially) pick up real reflections.
import * as THREE from 'three';

const C = (hex) => new THREE.Color(hex);

// Day-cycle keyframes. t: 0 midnight -> 0.5 noon -> 1 midnight.
const KEYS = [
  { t: 0.00, top: C('#050810'), mid: C('#0d1633'), bot: C('#1a2340'), sun: C('#93a7ff'), sunI: 0.75, hemiSky: C('#31427a'), hemiGnd: C('#141020'), amb: C('#42528a'), ambI: 0.75, fog: C('#0c142b'), exp: 1.2, stars: 1.0, envI: 0.4 },
  { t: 0.22, top: C('#1c2260'), mid: C('#7a4a7e'), bot: C('#ff9c6b'), sun: C('#ffb070'), sunI: 1.6, hemiSky: C('#7a5f9e'), hemiGnd: C('#3d2a1a'), amb: C('#8a6f8e'), ambI: 0.7, fog: C('#8a5f7e'), exp: 1.1, stars: 0.25, envI: 0.7 },
  { t: 0.30, top: C('#3a7bd5'), mid: C('#9ec9f0'), bot: C('#ffe3b8'), sun: C('#ffd9a8'), sunI: 2.2, hemiSky: C('#a8cdf0'), hemiGnd: C('#5a4a2a'), amb: C('#9db8d8'), ambI: 0.85, fog: C('#a8c8e8'), exp: 1.05, stars: 0.0, envI: 0.95 },
  { t: 0.50, top: C('#2a6fd0'), mid: C('#7ec8ff'), bot: C('#dff2ff'), sun: C('#fff4e0'), sunI: 2.9, hemiSky: C('#bfe6ff'), hemiGnd: C('#6b5a33'), amb: C('#a8bdd8'), ambI: 0.95, fog: C('#bfe0f8'), exp: 1.0, stars: 0.0, envI: 1.1 },
  { t: 0.70, top: C('#35418f'), mid: C('#c9739e'), bot: C('#ffb46b'), sun: C('#ff9a4d'), sunI: 2.0, hemiSky: C('#b07a9e'), hemiGnd: C('#4d3320'), amb: C('#9a7a90'), ambI: 0.8, fog: C('#b0789a'), exp: 1.12, stars: 0.1, envI: 0.85 },
  { t: 0.80, top: C('#141a4d'), mid: C('#5e3a70'), bot: C('#e07850'), sun: C('#ff8a5e'), sunI: 1.1, hemiSky: C('#4d3f70'), hemiGnd: C('#241a14'), amb: C('#5e4a70'), ambI: 0.65, fog: C('#4a3358'), exp: 1.15, stars: 0.55, envI: 0.55 },
  { t: 1.00, top: C('#050810'), mid: C('#0d1633'), bot: C('#1a2340'), sun: C('#93a7ff'), sunI: 0.75, hemiSky: C('#31427a'), hemiGnd: C('#141020'), amb: C('#42528a'), ambI: 0.75, fog: C('#0c142b'), exp: 1.2, stars: 1.0, envI: 0.4 },
];

export const PRESETS = {
  night: 0.0,
  dawn: 0.24,
  morning: 0.33,
  noon: 0.5,
  sunset: 0.73,
  dusk: 0.8
};

function sampleGrade(t) {
  t = ((t % 1) + 1) % 1;
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  }
  const k = (t - a.t) / Math.max(b.t - a.t, 1e-6);
  const mix = (ca, cb) => ca.clone().lerp(cb, k);
  const lerp = (x, y) => x + (y - x) * k;
  return {
    top: mix(a.top, b.top), mid: mix(a.mid, b.mid), bot: mix(a.bot, b.bot),
    sun: mix(a.sun, b.sun), sunI: lerp(a.sunI, b.sunI),
    hemiSky: mix(a.hemiSky, b.hemiSky), hemiGnd: mix(a.hemiGnd, b.hemiGnd),
    amb: mix(a.amb, b.amb), ambI: lerp(a.ambI, b.ambI),
    fog: mix(a.fog, b.fog), exp: lerp(a.exp, b.exp),
    stars: lerp(a.stars, b.stars), envI: lerp(a.envI, b.envI)
  };
}

function radialSprite(inner, outer, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Atmosphere {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.time = PRESETS.noon;
    this.cycleSpeed = 0;          // day-fractions per second (0 = static)
    this._envTimer = 0;

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;

    // lights
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -45; this.sun.shadow.camera.right = 45;
    this.sun.shadow.camera.top = 45; this.sun.shadow.camera.bottom = -45;
    this.sun.shadow.camera.far = 160;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfe6ff, 0x3a2a10, 0.8);
    this.amb = new THREE.AmbientLight(0x8899cc, 0.9);
    scene.add(this.hemi, this.amb);
    this.sunOffset = new THREE.Vector3(18, 30, 14);

    // sky dome (gradient + horizon glow canvas, redrawn on regrade)
    this.skyCanvas = document.createElement('canvas');
    this.skyCanvas.width = 96; this.skyCanvas.height = 1024;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(640, 48, 28),
      new THREE.MeshBasicMaterial({ map: this.skyTex, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    // dedicated equirect canvas that feeds the PMREM env map — painted with a
    // real sun disc + horizon glow so every PBR surface (glass balls, visors,
    // metal) picks up a genuine moving specular hotspot instead of a flat
    // gradient. Kept separate from the visible dome so there's only one sun.
    this.envCanvas = document.createElement('canvas');
    this.envCanvas.width = 512; this.envCanvas.height = 256;
    this.envTex = new THREE.CanvasTexture(this.envCanvas);
    this.envTex.colorSpace = THREE.SRGBColorSpace;
    this.envTex.mapping = THREE.EquirectangularReflectionMapping;

    // sun disc + moon
    this.sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialSprite('rgba(255,244,214,1)', 'rgba(255,200,120,0)'), fog: false, depthWrite: false, transparent: true
    }));
    this.sunDisc.scale.setScalar(120);
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialSprite('rgba(230,238,255,0.95)', 'rgba(160,180,255,0)'), fog: false, depthWrite: false, transparent: true
    }));
    this.moon.scale.setScalar(55);
    scene.add(this.sunDisc, this.moon);

    // stars
    const starGeo = new THREE.BufferGeometry();
    const N = 450, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      // deterministic pseudo-random points on the upper dome
      const u = ((i * 127.1) % 97) / 97, v = ((i * 311.7) % 89) / 89;
      const az = u * Math.PI * 2, el = 0.06 + v * 1.35;
      const r = 600;
      pos[i * 3] = Math.cos(az) * Math.cos(el) * r;
      pos[i * 3 + 1] = Math.sin(el) * r;
      pos[i * 3 + 2] = Math.sin(az) * Math.cos(el) * r;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xdde8ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false
    }));
    scene.add(this.stars);

    // fog: exponential falloff (FogExp2) reads as natural atmospheric depth
    // instead of the hard linear haze band. Density is derived from each
    // scene's requested far distance in setFogRange().
    this.fog = new THREE.FogExp2(0xbfe0f8, 0.006);
    scene.fog = this.fog;

    // environment reflections
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;

    this.regrade(true);
  }

  setPreset(name) {
    this.cycleSpeed = 0;
    this.time = PRESETS[name] ?? PRESETS.noon;
    this.regrade(true);
  }

  // full day in `seconds`
  enableCycle(seconds, startAt = this.time) {
    this.time = startAt;
    this.cycleSpeed = 1 / seconds;
    this.regrade(true);
  }

  setFogRange(near, far) {
    // map the old linear near/far intent onto an exponential density:
    // ~80% occluded by `far`, so distant geometry fades without a hard band
    this.fog.density = 1.3 / Math.max(far, 1);
  }

  sunElevation() {
    // 0.25 = sunrise, 0.5 = noon, 0.75 = sunset
    return Math.sin((this.time - 0.25) * Math.PI * 2);
  }

  regrade(rebuildEnv = false) {
    const g = sampleGrade(this.time);
    this.grade = g;

    const el = this.sunElevation();
    const dayness = THREE.MathUtils.clamp(el * 2 + 0.2, 0, 1);

    // visible sky dome: vertical gradient + a soft horizon glow so the
    // skyline reads as atmosphere rather than a flat ramp
    const H = this.skyCanvas.height;
    const ctx = this.skyCanvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#' + g.top.getHexString());
    grad.addColorStop(0.52, '#' + g.mid.getHexString());
    grad.addColorStop(1, '#' + g.bot.getHexString());
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.skyCanvas.width, H);
    // warm glow hugging the horizon (bottom third), strongest at low sun
    const glow = ctx.createLinearGradient(0, H * 0.62, 0, H);
    const gc = g.bot.clone().lerp(g.sun, 0.5);
    glow.addColorStop(0, 'rgba(0,0,0,0)');
    glow.addColorStop(1, `rgba(${(gc.r * 255) | 0},${(gc.g * 255) | 0},${(gc.b * 255) | 0},${(0.35 + (1 - dayness) * 0.35).toFixed(3)})`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, H * 0.62, this.skyCanvas.width, H * 0.38);
    this.skyTex.needsUpdate = true;

    // equirect env source: same sky + a bright sun disc at the sun's real
    // azimuth/elevation → real specular hotspot in every reflection
    this.paintEnvSky(g, el);

    // lights — leaner flat fill, richer directional key. The env map now
    // carries real directional fill, so ambient is cut back to let form read.
    this.sun.color.copy(el > -0.08 ? g.sun : g.sun.clone().lerp(C('#93a7ff'), THREE.MathUtils.clamp(-el * 4, 0, 1)));
    this.sun.intensity = g.sunI;
    this.hemi.color.copy(g.hemiSky);
    this.hemi.groundColor.copy(g.hemiGnd);
    this.hemi.intensity = 0.42 + dayness * 0.42;
    this.amb.color.copy(g.amb);
    this.amb.intensity = g.ambI * 0.5;
    this.fog.color.copy(g.fog);
    this.renderer.toneMappingExposure = g.exp;
    this.stars.material.opacity = g.stars * 0.9;
    if (this.scene.environmentIntensity !== undefined) this.scene.environmentIntensity = g.envI;

    // sun/moon travel across the dome
    const az = 0.7; // fixed azimuth so shadows stay readable
    const elv = Math.max(el, -0.6);
    const dir = new THREE.Vector3(Math.cos(az) * (1 - Math.abs(elv) * 0.5), Math.max(elv, 0.06), Math.sin(az) * (1 - Math.abs(elv) * 0.5)).normalize();
    this.sunOffset.copy(dir).multiplyScalar(46);
    this.sunDisc.material.opacity = THREE.MathUtils.clamp(el * 3 + 0.4, 0, 1);
    this.moon.material.opacity = THREE.MathUtils.clamp(-el * 2.4 + 0.15, 0, 0.95);

    if (rebuildEnv) this.rebuildEnv();
  }

  // paint the equirectangular env source: sky gradient + ground + a bright
  // sun disc & horizon glow at the sun's real azimuth/elevation
  paintEnvSky(g, el) {
    const c = this.envCanvas, ctx = c.getContext('2d');
    const W = c.width, Hh = c.height;
    const hex = (col) => '#' + col.getHexString();
    // vertical sky→horizon→ground gradient
    const grad = ctx.createLinearGradient(0, 0, 0, Hh);
    grad.addColorStop(0.0, hex(g.top));
    grad.addColorStop(0.42, hex(g.mid));
    grad.addColorStop(0.5, hex(g.bot));
    grad.addColorStop(0.5001, hex(g.hemiGnd.clone().lerp(g.bot, 0.5)));
    grad.addColorStop(1.0, hex(g.hemiGnd));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, Hh);
    // the sun (azimuth matches the shadow az=0.7 used in regrade)
    if (el > -0.12) {
      const su = ((0.7 / (Math.PI * 2)) % 1) * W;
      const sv = (0.5 - el * 0.5) * Hh;
      const bright = THREE.MathUtils.clamp(el * 2 + 0.5, 0, 1);
      // wide warm scatter glow
      const glow = ctx.createRadialGradient(su, sv, 0, su, sv, W * 0.34);
      const sc = g.sun;
      glow.addColorStop(0, `rgba(${(sc.r * 255) | 0},${(sc.g * 255) | 0},${(sc.b * 255) | 0},${(0.55 * bright).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, Hh);
      // bright core
      const core = ctx.createRadialGradient(su, sv, 0, su, sv, W * 0.05);
      core.addColorStop(0, `rgba(255,252,240,${(0.95 * bright).toFixed(3)})`);
      core.addColorStop(1, 'rgba(255,240,210,0)');
      ctx.fillStyle = core;
      ctx.fillRect(0, 0, W, Hh);
      ctx.globalCompositeOperation = 'source-over';
    }
    this.envTex.needsUpdate = true;
  }

  rebuildEnv() {
    const old = this.envRT;
    this.envRT = this.pmrem.fromEquirectangular(this.envTex);
    this.scene.environment = this.envRT.texture;
    if (old) old.dispose();
  }

  // follow a focal point (the ball / diorama center) so shadows & sky stay centered
  update(dt, focus) {
    if (this.cycleSpeed > 0) {
      this.time = (this.time + dt * this.cycleSpeed) % 1;
      this.regrade(false);
      this._envTimer -= dt;
      if (this._envTimer <= 0) { this._envTimer = 3.5; this.rebuildEnv(); }
    }
    if (focus) {
      this.sun.position.copy(focus).add(this.sunOffset.clone().multiplyScalar(1.2)).add(new THREE.Vector3(0, 8, 0));
      this.sun.target.position.copy(focus);
      this.dome.position.copy(focus);
      this.stars.position.copy(focus);
      // celestial bodies out along their directions from the focus
      const sunDir = this.sunOffset.clone().normalize();
      this.sunDisc.position.copy(focus).addScaledVector(sunDir, 560);
      this.moon.position.copy(focus).addScaledVector(new THREE.Vector3(-sunDir.x, Math.max(0.35, sunDir.y), -sunDir.z).normalize(), 560);
    }
  }
}
