// GPU ray-marching renderer for scalar fields on regular grids (electron
// densities, orbital amplitudes, electrostatic potentials).
//
// Scene units are picometres. The volume occupies its true physical extent,
// so camera distances, the scale bar and measurements all refer to the same
// coordinates as the calculation.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type FieldKind = "density" | "amplitude" | "density+phase" | "density+esp" | "signed";

export interface VolumeField {
  values: Float32Array; // x varies fastest
  shape: [number, number, number];
  originPm: [number, number, number];
  spacingPm: number;
  kind: FieldKind;
  aux?: Float32Array; // phase (rad) or ESP (hartree/e), same layout
  auxRange?: [number, number];
  maxDensity: number; // max of the density implied by `values`
}

export interface DisplaySettings {
  mode: "volume" | "isosurface";
  densityThreshold: number; // isosurface at rho = threshold (|psi| = sqrt for amplitudes)
  opacity: number;
  logScale: boolean;
  logDecades: number;
  clip: { enabled: boolean; axis: 0 | 1 | 2; offsetPm: number; flip: boolean };
  showAxes: boolean;
}

export interface ViewInfo {
  pmPerPx: number;
  viewWidthPm: number;
  cameraDistancePm: number;
  nucleusExaggeration: number; // 1 = true size
  orthographic: boolean;
}

const KIND_INDEX: Record<FieldKind, number> = {
  density: 0,
  amplitude: 1,
  "density+phase": 2,
  "density+esp": 3,
  signed: 4, // signed scalar such as spin density: |v| is the magnitude
};

const vertexShader = /* glsl */ `
  uniform vec3 uCamPos;
  uniform vec3 uCamDir;
  uniform int uOrtho;
  out vec3 vOrigin;
  out vec3 vDirection;
  void main() {
    // Rays are traced in world coordinates (pm).
    vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
    if (uOrtho == 1) {
      vDirection = uCamDir;
      vOrigin = world - uCamDir * 1e7;
    } else {
      vOrigin = uCamPos;
      vDirection = world - uCamPos;
    }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  precision highp sampler3D;
  uniform sampler3D uVol;
  uniform sampler3D uAux;
  uniform vec3 uBoxMin;
  uniform vec3 uBoxMax;
  uniform vec3 uTexScale;
  uniform vec3 uTexOffset;
  uniform int uMode;
  uniform int uKind;
  uniform float uIso;
  uniform float uMax;
  uniform float uOpacity;
  uniform int uLog;
  uniform float uDecades;
  uniform int uClipOn;
  uniform vec4 uClip;
  uniform float uStep;
  uniform vec2 uAuxRange;
  uniform float uNucR;
  uniform sampler2D uDepth;
  uniform int uHasSolid;
  uniform mat4 uInvViewProj;
  uniform vec2 uResolution;
  in vec3 vOrigin;
  in vec3 vDirection;
  out vec4 outColor;

  vec2 hitBox(vec3 o, vec3 d) {
    vec3 inv = 1.0 / d;
    vec3 t0 = (uBoxMin - o) * inv;
    vec3 t1 = (uBoxMax - o) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
  }
  float hitSphere(vec3 o, vec3 d, float r) {
    float b = dot(o, d);
    float c = dot(o, o) - r * r;
    float h = b * b - c;
    if (h < 0.0) return 1e30;
    float t = -b - sqrt(h);
    return t > 0.0 ? t : 1e30;
  }
  float raw(vec3 p) { return texture(uVol, p * uTexScale + uTexOffset).r; }
  // Scalar used for isosurfaces: density, or |psi| for amplitudes.
  float iso(vec3 p) { float v = raw(p); return (uKind == 1 || uKind == 4) ? abs(v) : v; }
  float density(float v) { return uKind == 1 ? v * v : (uKind == 4 ? abs(v) : v); }
  bool clipped(vec3 p) { return uClipOn == 1 && dot(p, uClip.xyz) > uClip.w; }

  // Inferno colour map (polynomial fit by Matt Zucker, CC0).
  vec3 inferno(float t) {
    const vec3 c0 = vec3(0.0002189403691192265, 0.001651004631001012, -0.01948089843709184);
    const vec3 c1 = vec3(0.1065134194856116, 0.5639564367884091, 3.932712388889277);
    const vec3 c2 = vec3(11.60249308247187, -3.972853965665698, -15.9423941062914);
    const vec3 c3 = vec3(-41.70399613139459, 17.43639888205313, 44.35414519872813);
    const vec3 c4 = vec3(77.162935699427, -33.40235894210092, -81.80730925738993);
    const vec3 c5 = vec3(-71.31942824499214, 32.62606426397723, 73.20951985803202);
    const vec3 c6 = vec3(25.13112622477341, -12.24266895238567, -23.07032500287172);
    t = clamp(t, 0.0, 1.0);
    return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
  }
  vec3 hue(float a) {
    vec3 k = vec3(0.0, 2.0943951, 4.1887902);
    return 0.55 + 0.45 * cos(a - k);
  }
  // Diverging blue-white-red, centred on zero when the range spans it.
  vec3 diverging(float v) {
    float lo = uAuxRange.x, hi = uAuxRange.y;
    float t;
    if (lo < 0.0 && hi > 0.0) t = v < 0.0 ? 0.5 - 0.5 * v / lo : 0.5 + 0.5 * v / hi;
    else t = (v - lo) / max(hi - lo, 1e-30);
    t = clamp(t, 0.0, 1.0);
    vec3 blue = vec3(0.23, 0.30, 0.75), white = vec3(0.87), red = vec3(0.71, 0.02, 0.15);
    return t < 0.5 ? mix(blue, white, t * 2.0) : mix(white, red, t * 2.0 - 1.0);
  }
  vec3 surfaceColour(vec3 p) {
    if (uKind == 1 || uKind == 4) return raw(p) >= 0.0 ? vec3(0.90, 0.35, 0.25) : vec3(0.25, 0.50, 0.90);
    vec3 a = vec3(texture(uAux, p * uTexScale + uTexOffset).r);
    if (uKind == 2) return hue(a.x);
    if (uKind == 3) return diverging(a.x);
    return vec3(0.35, 0.75, 0.85);
  }
  float transfer(float rho) {
    float x = max(rho / uMax, 0.0);
    if (uLog == 1) return clamp((log(max(x, 1e-30)) / log(10.0) + uDecades) / uDecades, 0.0, 1.0);
    return clamp(x, 0.0, 1.0);
  }
  vec3 gradient(vec3 p) {
    float h = uStep;
    return vec3(
      iso(p + vec3(h, 0, 0)) - iso(p - vec3(h, 0, 0)),
      iso(p + vec3(0, h, 0)) - iso(p - vec3(0, h, 0)),
      iso(p + vec3(0, 0, h)) - iso(p - vec3(0, 0, h)));
  }

  void main() {
    vec3 dir = normalize(vDirection);
    vec2 b = hitBox(vOrigin, dir);
    if (b.x > b.y) discard;
    b.x = max(b.x, 0.0);
    float tNuc = hitSphere(vOrigin, dir, uNucR);
    float tSolid = 1e30;
    if (uHasSolid == 1) {
      // stop rays at opaque structure geometry (atoms, bonds) drawn in the depth pre-pass
      vec2 uv = gl_FragCoord.xy / uResolution;
      float d = texture(uDepth, uv).r;
      if (d < 1.0) {
        vec4 w = uInvViewProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        tSolid = dot(w.xyz / w.w - vOrigin, dir);
      }
    }
    float tEnd = min(min(b.y, tNuc), tSolid);
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    vec4 acc = vec4(0.0);
    float t = b.x + jitter * uStep;
    for (int i = 0; i < 1024; i++) {
      if (t > tEnd || acc.a > 0.98) break;
      vec3 p = vOrigin + dir * t;
      if (!clipped(p)) {
        if (uMode == 1) {
          float s = iso(p);
          if (s >= uIso) {
            // refine the crossing between the previous and current sample
            float lo = t - uStep, hi = t;
            for (int k = 0; k < 6; k++) {
              float mid = 0.5 * (lo + hi);
              if (iso(vOrigin + dir * mid) >= uIso) hi = mid; else lo = mid;
            }
            vec3 q = vOrigin + dir * hi;
            vec3 n = -normalize(gradient(q) + 1e-30);
            float diff = abs(dot(n, -dir));
            vec3 c = surfaceColour(q) * (0.25 + 0.75 * diff) + 0.25 * pow(diff, 24.0);
            float a = uOpacity;
            acc.rgb += (1.0 - acc.a) * a * c;
            acc.a += (1.0 - acc.a) * a;
            // skip through the lobe so a translucent surface shows its back side once
            for (int k = 0; k < 512; k++) {
              t += uStep;
              if (t > tEnd || iso(vOrigin + dir * t) < uIso) break;
            }
          }
        } else {
          float v = raw(p);
          float x = transfer(density(v));
          if (x > 0.0) {
            vec3 c = uKind == 0 ? inferno(0.15 + 0.85 * x) : surfaceColour(p);
            // emission-absorption with extinction proportional to the mapped density
            float a = 1.0 - exp(-uOpacity * x * 40.0 * uStep / (uBoxMax.x - uBoxMin.x));
            acc.rgb += (1.0 - acc.a) * a * c;
            acc.a += (1.0 - acc.a) * a;
          }
        }
      }
      t += uStep;
    }
    if (tNuc < b.y && tNuc < tSolid && acc.a < 0.98) {
      vec3 q = vOrigin + dir * tNuc;
      float diff = abs(dot(normalize(q), -dir));
      vec3 c = vec3(0.95, 0.85, 0.30) * (0.35 + 0.65 * diff);
      acc.rgb += (1.0 - acc.a) * c;
      acc.a = 1.0;
    }
    if (acc.a < 0.002) discard;
    outColor = vec4(acc.rgb / max(acc.a, 1e-4), acc.a);
  }
`;

export class VolumeRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private persp: THREE.PerspectiveCamera;
  private ortho: THREE.OrthographicCamera;
  private camera: THREE.Camera;
  private controls: OrbitControls;
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private axes = new THREE.AxesHelper(1);
  private textures: THREE.Data3DTexture[] = [];
  private field: VolumeField | null = null;
  private nucleusRadiusPm = 0;
  private dirty = true;
  private frame = 0;
  private resizeObserver: ResizeObserver;
  private floatLinear: boolean;
  /** Opaque structure geometry (atoms, bonds, cells), drawn before the volume. */
  readonly solids = new THREE.Group();
  private solidScene = new THREE.Scene();
  private target: THREE.WebGLRenderTarget;
  private copyScene = new THREE.Scene();
  private copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private raycaster = new THREE.Raycaster();
  onView: (v: ViewInfo) => void = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x0b0e14, 1);
    container.appendChild(this.renderer.domElement);
    this.floatLinear = this.renderer.extensions.has("OES_texture_float_linear");

    this.persp = new THREE.PerspectiveCamera(40, 1, 0.01, 1e9);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e9, 1e9);
    this.camera = this.persp;
    this.persp.position.set(300, 220, 420);
    this.controls = this.makeControls();

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uVol: { value: null },
        uAux: { value: null },
        uBoxMin: { value: new THREE.Vector3() },
        uBoxMax: { value: new THREE.Vector3() },
        uTexScale: { value: new THREE.Vector3() },
        uTexOffset: { value: new THREE.Vector3() },
        uMode: { value: 0 },
        uKind: { value: 0 },
        uIso: { value: 0 },
        uMax: { value: 1 },
        uOpacity: { value: 1 },
        uLog: { value: 0 },
        uDecades: { value: 4 },
        uClipOn: { value: 0 },
        uClip: { value: new THREE.Vector4() },
        uStep: { value: 1 },
        uAuxRange: { value: new THREE.Vector2() },
        uNucR: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uCamDir: { value: new THREE.Vector3() },
        uOrtho: { value: 0 },
        uDepth: { value: null },
        uHasSolid: { value: 0 },
        uInvViewProj: { value: new THREE.Matrix4() },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material);
    this.mesh.visible = false;
    this.scene.add(this.mesh);
    this.scene.add(this.axes);

    this.solidScene.add(this.solids);
    this.solidScene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 2, 3);
    this.solidScene.add(key);
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
    this.material.uniforms.uDepth.value = this.target.depthTexture;
    this.copyScene.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3,
          depthTest: false,
          depthWrite: false,
          uniforms: { uTex: { value: this.target.texture } },
          vertexShader: "out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
          fragmentShader: `precision highp float; uniform sampler2D uTex; in vec2 vUv; out vec4 c;
            vec3 toSRGB(vec3 x) { return mix(x * 12.92, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, x)); }
            void main() { vec4 t = texture(uTex, vUv); c = vec4(toSRGB(t.rgb), 1.0); }`,
        }),
      ),
    );

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      if (this.dirty) this.render();
    };
    loop();
  }

  private makeControls(): OrbitControls {
    const c = new OrbitControls(this.camera, this.renderer.domElement);
    c.enableDamping = false;
    c.zoomSpeed = 1.2;
    c.minDistance = 1e-4; // 0.1 fm: lets the user reach the nuclear scale
    c.maxDistance = 1e8; // 100 µm
    c.minZoom = 1e-6;
    c.maxZoom = 1e7;
    c.addEventListener("change", () => (this.dirty = true));
    return c;
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.textures.forEach((t) => t.dispose());
    this.target.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize() {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(w, h);
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(buf.x, buf.y);
    this.material.uniforms.uResolution.value.copy(buf);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.updateOrthoFrustum();
    this.dirty = true;
  }

  private updateOrthoFrustum() {
    const el = this.renderer.domElement;
    const aspect = el.clientWidth / Math.max(el.clientHeight, 1);
    const d = this.persp.position.distanceTo(this.controls?.target ?? new THREE.Vector3());
    const h = d * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
    this.ortho.top = h;
    this.ortho.bottom = -h;
    this.ortho.left = -h * aspect;
    this.ortho.right = h * aspect;
    this.ortho.updateProjectionMatrix();
  }

  setOrthographic(on: boolean) {
    if (on === (this.camera === this.ortho)) return;
    const target = this.controls.target.clone();
    if (on) {
      this.ortho.position.copy(this.persp.position);
      this.ortho.quaternion.copy(this.persp.quaternion);
      this.ortho.zoom = 1;
      this.updateOrthoFrustum();
      this.camera = this.ortho;
    } else {
      const dir = this.ortho.position.clone().sub(target).normalize();
      const d = this.persp.position.distanceTo(target) / this.ortho.zoom;
      this.persp.position.copy(target).addScaledVector(dir, d);
      this.camera = this.persp;
    }
    this.controls.dispose();
    this.controls = this.makeControls();
    this.controls.target.copy(target);
    this.controls.update();
    this.dirty = true;
  }

  resetView() {
    const half = this.field ? (this.field.shape[0] - 1) * this.field.spacingPm * 0.5 : 300;
    this.controls.target.set(0, 0, 0);
    this.persp.position.set(1.1, 0.8, 1.5).multiplyScalar(half * 1.4);
    this.ortho.position.copy(this.persp.position);
    this.ortho.zoom = 1;
    this.updateOrthoFrustum();
    this.controls.update();
    this.dirty = true;
  }

  setNucleusRadiusPm(r: number) {
    this.nucleusRadiusPm = r;
    this.dirty = true;
  }

  setField(field: VolumeField | null, resetCamera = false) {
    this.textures.forEach((t) => t.dispose());
    this.textures = [];
    this.field = field;
    this.mesh.visible = !!field;
    if (!field) {
      this.dirty = true;
      return;
    }
    const [nx, ny, nz] = field.shape;
    const make = (data: Float32Array) => {
      const tex = new THREE.Data3DTexture(data as Float32Array<ArrayBuffer>, nx, ny, nz); // never SharedArrayBuffer-backed
      tex.format = THREE.RedFormat;
      tex.type = THREE.FloatType;
      const filter = this.floatLinear ? THREE.LinearFilter : THREE.NearestFilter;
      tex.minFilter = filter;
      tex.magFilter = filter;
      tex.unpackAlignment = 1;
      tex.needsUpdate = true;
      this.textures.push(tex);
      return tex;
    };
    const u = this.material.uniforms;
    u.uVol.value = make(field.values);
    u.uAux.value = field.aux ? make(field.aux) : make(new Float32Array(nx * ny * nz));
    const size = [nx, ny, nz].map((n) => (n - 1) * field.spacingPm);
    const min = new THREE.Vector3(...field.originPm);
    const max = min.clone().add(new THREE.Vector3(...size));
    u.uBoxMin.value.copy(min);
    u.uBoxMax.value.copy(max);
    // grid point i sits at texel centre (i + 0.5) / n
    const scale = new THREE.Vector3(...[nx, ny, nz].map((n, i) => (n - 1) / n / size[i]));
    u.uTexScale.value.copy(scale);
    u.uTexOffset.value.set(
      ...([0, 1, 2].map((i) => 0.5 / [nx, ny, nz][i] - min.getComponent(i) * scale.getComponent(i)) as [
        number,
        number,
        number,
      ]),
    );
    u.uKind.value = KIND_INDEX[field.kind];
    u.uMax.value = field.maxDensity;
    u.uAuxRange.value.set(...(field.auxRange ?? [0, 1]));
    u.uStep.value = Math.min(...size) / Math.max(nx, ny, nz) / 1.5;
    this.mesh.scale.set(size[0], size[1], size[2]);
    this.mesh.position.copy(min.clone().add(max).multiplyScalar(0.5));
    this.axes.scale.setScalar(Math.max(...size) * 0.5);
    if (resetCamera) this.resetView();
    this.dirty = true;
  }

  setDisplay(d: DisplaySettings) {
    const u = this.material.uniforms;
    u.uMode.value = d.mode === "isosurface" ? 1 : 0;
    const kind = this.field?.kind ?? "density";
    u.uIso.value = kind === "amplitude" ? Math.sqrt(Math.max(d.densityThreshold, 0)) : d.densityThreshold;
    u.uOpacity.value = d.opacity;
    u.uLog.value = d.logScale ? 1 : 0;
    u.uDecades.value = d.logDecades;
    u.uClipOn.value = d.clip.enabled ? 1 : 0;
    const normal = new THREE.Vector3().setComponent(d.clip.axis, d.clip.flip ? -1 : 1);
    u.uClip.value.set(normal.x, normal.y, normal.z, (d.clip.flip ? -1 : 1) * d.clip.offsetPm);
    this.axes.visible = d.showAxes;
    this.dirty = true;
  }

  private pmPerPx(): number {
    const h = this.renderer.domElement.clientHeight || 1;
    if (this.camera === this.ortho) return (this.ortho.top - this.ortho.bottom) / this.ortho.zoom / h;
    const d = this.persp.position.distanceTo(this.controls.target);
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2))) / h;
  }

  private render() {
    this.dirty = false;
    const cam = this.camera === this.ortho ? this.ortho : this.persp;
    const dist = cam.position.distanceTo(this.controls.target);
    if (cam === this.persp) {
      this.persp.near = Math.max(dist * 1e-3, 1e-6);
      this.persp.far = dist * 1e3 + 1e4;
      this.persp.updateProjectionMatrix();
    }
    const pmPerPx = this.pmPerPx();
    // Nucleus: true size unless it would be smaller than ~3 px.
    const minVisible = 3 * pmPerPx;
    const shown = this.nucleusRadiusPm > 0 ? Math.max(this.nucleusRadiusPm, minVisible) : 0;
    const u = this.material.uniforms;
    u.uNucR.value = shown;
    u.uCamPos.value.copy(cam.position);
    u.uCamDir.value.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion));
    u.uOrtho.value = cam === this.ortho ? 1 : 0;
    const hasSolid = this.solids.children.some((c) => c.visible);
    u.uHasSolid.value = hasSolid ? 1 : 0;
    if (hasSolid) {
      cam.updateMatrixWorld();
      u.uInvViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert();
      this.renderer.setRenderTarget(this.target);
      this.renderer.render(this.solidScene, cam);
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.copyScene, this.copyCamera);
      this.renderer.autoClear = false;
      this.renderer.render(this.scene, cam);
      this.renderer.autoClear = true;
    } else {
      this.renderer.render(this.scene, cam);
    }
    this.onView({
      pmPerPx,
      viewWidthPm: pmPerPx * this.renderer.domElement.clientWidth,
      cameraDistancePm: dist,
      nucleusExaggeration: this.nucleusRadiusPm > 0 ? shown / this.nucleusRadiusPm : 1,
      orthographic: cam === this.ortho,
    });
  }

  requestRender() {
    this.dirty = true;
  }

  /** Centre the view on a point (pm) at a distance that shows `radiusPm`. */
  frameView(centrePm: THREE.Vector3, radiusPm: number) {
    const dir = this.persp.position.clone().sub(this.controls.target).normalize();
    if (dir.lengthSq() === 0) dir.set(0.4, 0.3, 1).normalize();
    const d = radiusPm / Math.sin(THREE.MathUtils.degToRad(this.persp.fov / 2)) + radiusPm * 0.2;
    this.controls.target.copy(centrePm);
    this.persp.position.copy(centrePm).addScaledVector(dir, d);
    this.ortho.position.copy(this.persp.position);
    this.ortho.zoom = 1;
    this.updateOrthoFrustum();
    this.controls.update();
    this.dirty = true;
  }

  /** Raycast against objects in the solid layer. */
  pick(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection[] {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObjects(objects, false);
  }

  /** Point (pm) where the pointer ray meets the plane through the orbit target facing the camera. */
  pointOnViewPlane(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const normal = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.controls.target);
    return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  }

  get activeCamera(): THREE.Camera {
    return this.camera;
  }

  /** Render at `scale` x resolution and return a PNG data URL. */
  exportPNG(scale = 3): string {
    const ratio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(ratio * scale);
    this.resize();
    this.render();
    const url = this.renderer.domElement.toDataURL("image/png");
    this.renderer.setPixelRatio(ratio);
    this.resize();
    this.dirty = true;
    return url;
  }
}
