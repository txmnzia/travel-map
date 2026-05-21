import * as THREE from 'three';
import * as turf from '@turf/turf';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import maplibregl from 'maplibre-gl';
import { interpolateAlong } from '../utils/routing';

const textureLoader = new THREE.TextureLoader();

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

const NON_PAINT_NAMES = [
  'window', 'glass', 'windshield', 'windscreen', 'visor',
  'wheel', 'tyre', 'tire', 'hub', 'rim',
  'chrome', 'headlight', 'taillight', 'blinker', 'lamp', 'light',
];

function isTintable(mat: THREE.MeshStandardMaterial): boolean {
  const name = mat.name.toLowerCase();
  if (NON_PAINT_NAMES.some(p => name.includes(p))) return false;
  if (mat.transparent && mat.opacity < 0.9) return false;
  if ((((mat as unknown) as { transmission?: number }).transmission ?? 0) > 0.1) return false;
  if (mat.metalness > 0.6) return false;
  if (!mat.map) {
    const { r, g, b } = mat.color;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max > 0.001 ? (max - min) / max : 0;
    // Dark + unsaturated = rubber / tires / black trim
    if (lum < 0.2 && sat < 0.15) return false;
  }
  return true;
}

interface TrainPart {
  group: THREE.Group; // at scene origin; camera matrix encodes per-part world transform
  zOffset: number;    // distance behind loco center in normalised model units (positive = behind)
}

/**
 * MapLibre custom layer that renders a GLTF/GLB vehicle model in 3D map space.
 *
 * Single-vehicle mode: one render pass, camera = mapMatrix × modelMatrix.
 *
 * Multi-part train mode: one render pass PER part, each part isolated with
 * group.visible while camera = mapMatrix × partModelMatrix. This reuses the
 * proven single-model approach so depth/blend state is identical. Each
 * part's modelMatrix is looked up from the route at its own lag offset,
 * so rear wagons follow curves later — like a real train.
 */
export class VehicleLayer {
  readonly id = 'vehicle-layer';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map!: maplibregl.Map;
  private scene!: THREE.Scene;
  private camera!: THREE.Camera;
  private renderer!: THREE.WebGLRenderer;

  // Single-model state
  private model: THREE.Group | null = null;
  private modelAnimStart = 0;
  private outgoing: THREE.Group | null = null;
  private outgoingAnimStart = 0;

  // Multi-part train state
  private trainParts: TrainPart[] = [];
  private trainAnimStart = 0;
  private leanAngles: number[] = [];
  private prevPartBearings: number[] = [];

  private readonly loader = new GLTFLoader();
  private loadingUrl = '';

  scaleFactor = 1;
  userScaleFactor = 1;
  position: [number, number] = [0, 0];
  bearing = 0;
  bobEnabled = false;

  // Route for train articulation — set by AnimationPlayer each frame
  route: [number, number][] = [];
  totalKm = 0;
  progress = 0;

  // Single-model lean
  private leanAngle = 0;
  private prevBearing = 0;
  private prevRenderTime = 0;

  // Arrival shrink-out (per-wagon for trains; single value for other vehicles)
  private partDisappearStarts: number[] = [];
  private singleDisappearStart = 0;

  // User-chosen colour tint (null = use model's original colours)
  userTint: string | null = null;

  /** Returns true once every part has fully shrunk out. */
  isFullyDone(): boolean {
    const now = performance.now();
    if (this.trainParts.length > 0) {
      return this.trainParts.every((_, i) => {
        const s = this.partDisappearStarts[i];
        return s > 0 && now - s >= 350;
      });
    }
    return this.singleDisappearStart > 0 && now - this.singleDisappearStart >= 350;
  }

  /** Apply (or clear) a colour tint on all currently loaded mesh materials. */
  setTint(color: string | null) {
    this.userTint = color;
    this._applyTintToScene();
    this.map?.triggerRepaint();
  }

  private _applyTintToScene() {
    const applyTo = (obj: THREE.Object3D) => {
      if (obj instanceof THREE.Mesh) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          const mat = m as THREE.MeshStandardMaterial;
          if (!mat.userData.tintable) return;
          if (this.userTint) {
            mat.color.set(this.userTint);
          } else {
            const orig = (mat as THREE.MeshStandardMaterial & { __origColor?: THREE.Color }).__origColor;
            if (orig) mat.color.copy(orig);
          }
          mat.needsUpdate = true;
        });
      }
      obj.children.forEach(c => applyTo(c));
    };
    if (this.model) applyTo(this.model);
    this.trainParts.forEach(p => applyTo(p.group));
  }

  /** Trigger disappear animation. staggerMs only used for manual (non-position-based) calls. */
  startDisappear(staggerMs = 0): number {
    const now = performance.now();
    if (this.trainParts.length > 0) {
      this.partDisappearStarts = this.trainParts.map((_, i) => now + i * staggerMs);
    } else {
      this.singleDisappearStart = now;
    }
    this.map?.triggerRepaint();
    return this.trainParts.length > 0 ? (this.trainParts.length - 1) * staggerMs + 350 : 350;
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();

    this.scene.add(new THREE.AmbientLight(0xffffff, 3));
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.position.set(1, 2, 3);
    this.scene.add(sun);

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
    });
    this.renderer.autoClear = false;
  }

  loadModel(url: string, scaleFactor = 1) {
    if (url === this.loadingUrl) return;
    this.loadingUrl = url;
    this.scaleFactor = scaleFactor;

    this._clearTrainParts();
    this.partDisappearStarts = [];
    this.singleDisappearStart = 0;

    if (this.model) {
      if (this.outgoing) this.scene.remove(this.outgoing);
      this.outgoing = this.model;
      this.outgoingAnimStart = performance.now();
      this.model = null;
    }

    this.loader.load(
      url,
      (gltf) => {
        if (this.loadingUrl !== url) return;
        const glbScene = gltf.scene;

        const box = new THREE.Box3().setFromObject(glbScene);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) glbScene.scale.setScalar(1 / maxDim);

        const center = box.getCenter(new THREE.Vector3());
        glbScene.position.x -= center.x / maxDim;
        glbScene.position.z -= center.z / maxDim;

        glbScene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => {
              const mat = m as THREE.MeshStandardMaterial & { __origColor?: THREE.Color };
              mat.userData.tintable = isTintable(mat);
              mat.__origColor = mat.color.clone();
              mat.side = THREE.FrontSide;
              mat.transparent = false;
              mat.depthWrite = true;
              mat.alphaTest = 0.1;
            });
          }
        });

        const wrapper = new THREE.Group();
        wrapper.add(glbScene);
        wrapper.scale.setScalar(0);

        this.model = wrapper;
        this.modelAnimStart = performance.now();
        this.scene.add(wrapper);
        this._applyTintToScene();
        this.map?.triggerRepaint();
      },
      undefined,
      (err) => console.warn('VehicleLayer: failed to load', url, err),
    );
  }

  loadParts(urls: string[], scaleFactor = 1, colormapUrl?: string) {
    const key = 'parts:' + urls.join('\n');
    if (key === this.loadingUrl) return;
    this.loadingUrl = key;
    this.scaleFactor = scaleFactor;

    this._clearTrainParts();
    this.partDisappearStarts = [];
    this.singleDisappearStart = 0;
    if (this.outgoing) { this.scene.remove(this.outgoing); this.outgoing = null; }
    if (this.model) { this.scene.remove(this.model); this.model = null; }

    const glbPromises = urls.map(url => new Promise<THREE.Group>((resolve, reject) =>
      this.loader.load(url, gltf => resolve(gltf.scene), undefined, reject),
    ));

    const texPromise = colormapUrl
      ? new Promise<THREE.Texture>((resolve, reject) =>
          textureLoader.load(colormapUrl, tex => {
            tex.flipY = false;
            tex.colorSpace = THREE.SRGBColorSpace;
            resolve(tex);
          }, undefined, reject),
        )
      : Promise.resolve(null);

    Promise.all([Promise.all(glbPromises), texPromise] as const).then(([parts, colormap]) => {
      if (this.loadingUrl !== key) return;

      const GAP = 0.03;
      let zCursor = 0;

      const newParts: TrainPart[] = parts.map((part, i) => {
        // Normalise each wagon independently so it matches a single-model vehicle in visual size
        const rawBox = new THREE.Box3().setFromObject(part);
        const rawSize = rawBox.getSize(new THREE.Vector3());
        part.scale.setScalar(1 / Math.max(rawSize.x, rawSize.y, rawSize.z, 0.001));

        part.traverse(child => {
          if (child instanceof THREE.Mesh) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => {
              const mat = m as THREE.MeshStandardMaterial & { __origColor?: THREE.Color };
              mat.userData.tintable = isTintable(mat);
              mat.__origColor = mat.color.clone();
              if (colormap) mat.map = colormap;
              mat.side = THREE.FrontSide;
              mat.transparent = false;
              mat.depthWrite = true;
              mat.alphaTest = 0.1;
              mat.needsUpdate = true;
            });
          }
        });

        const box = new THREE.Box3().setFromObject(part);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const halfZ = size.z / 2;

        // Centre each part at its group's local origin
        part.position.x = -center.x;
        part.position.z = -center.z;

        let zOffset: number;
        if (i === 0) {
          zOffset = 0;
          zCursor = halfZ;
        } else {
          zOffset = zCursor + GAP + halfZ;
          zCursor = zOffset + halfZ;
        }

        // Each group sits at scene origin; the camera matrix carries the world transform
        const group = new THREE.Group();
        group.add(part);
        this.scene.add(group);

        return { group, zOffset };
      });

      this.trainParts = newParts;
      this.leanAngles = new Array(newParts.length).fill(0);
      this.prevPartBearings = new Array(newParts.length).fill(this.bearing);
      this.trainAnimStart = performance.now();
      this._applyTintToScene();
      this.map?.triggerRepaint();
    }).catch(err => console.warn('VehicleLayer: failed to compose parts', err));
  }

  private _clearTrainParts() {
    this.trainParts.forEach(p => this.scene.remove(p.group));
    this.trainParts = [];
    this.leanAngles = [];
    this.prevPartBearings = [];
    this.trainAnimStart = 0;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(_gl: unknown, matrix: any) {
    const hasTrain = this.trainParts.length > 0;
    if (!this.model && !this.outgoing && !hasTrain) return;

    const now = performance.now();
    const dt = this.prevRenderTime > 0 ? Math.min(now - this.prevRenderTime, 50) : 16;
    this.prevRenderTime = now;

    const zoom = this.map.getZoom();
    const metersPerPx = 40_075_017 / (512 * Math.pow(2, zoom));
    const desiredMeters = 80 * metersPerPx * this.scaleFactor * this.userScaleFactor;
    const mapMatrix = new THREE.Matrix4().fromArray(matrix);

    if (hasTrain) {
      // ── Multi-part train: one render pass per part ──────────────────────
      // Each pass isolates one group (others hidden) and uses
      // camera = mapMatrix × partModelMatrix — same as the single-model path,
      // so depth/blend/stencil state is guaranteed correct.

      let animScale = 1;
      if (this.trainAnimStart > 0) {
        const t = Math.min((now - this.trainAnimStart) / 280, 1);
        animScale = Math.max(0, easeOutBack(t));
        if (t >= 1) this.trainAnimStart = 0;
      }

      this.trainParts.forEach(({ group, zOffset }, i) => {
        const offsetKm = zOffset * desiredMeters / 1000;
        const rawProg = this.route.length >= 2 && this.totalKm > 0
          ? this.progress - offsetKm / this.totalKm
          : this.progress;

        let pos: [number, number];
        let bear: number;
        if (this.route.length >= 2) {
          if (rawProg >= 1) {
            // Wagon has reached the destination — trigger its own disappear
            if (!this.partDisappearStarts[i]) this.partDisappearStarts[i] = now;
            ({ position: pos } = interpolateAlong(this.route, 0.9999));
            bear = this.prevPartBearings[i]; // freeze bearing — prevents snap-rotation on arrival
          } else if (rawProg < 0 && this.totalKm > 0) {
            // Wagon is behind the route start — extrapolate backwards
            const { position: startPos, bearing: startBear } = interpolateAlong(this.route, 0);
            const behindKm = -rawProg * this.totalKm;
            const pt = turf.destination(turf.point(startPos), behindKm, startBear + 180, { units: 'kilometers' });
            pos = pt.geometry.coordinates as [number, number];
            bear = startBear;
          } else {
            ({ position: pos, bearing: bear } = interpolateAlong(this.route, rawProg));
          }
        } else {
          pos = this.position;
          bear = this.bearing;
        }

        // Per-part banking lean
        let delta = bear - this.prevPartBearings[i];
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        this.prevPartBearings[i] = bear;
        const targetLean = Math.max(-0.30, Math.min(0.30, -delta * 0.05));
        this.leanAngles[i] += (targetLean - this.leanAngles[i]) * Math.min(1, 0.15 * (dt / 16));

        let wagonDisappearScale = 1;
        const wds = this.partDisappearStarts[i];
        if (wds > 0) {
          const t = Math.min((now - wds) / 350, 1);
          wagonDisappearScale = Math.max(0, 1 - t * t);
        }

        const pCoord = maplibregl.MercatorCoordinate.fromLngLat({ lng: pos[0], lat: pos[1] }, 0);
        const ps = pCoord.meterInMercatorCoordinateUnits() * desiredMeters * animScale * wagonDisappearScale;
        const bobAmt = this.bobEnabled ? Math.sin(now * 0.00785 + i * 0.8) * 0.05 * ps : 0;
        const bearingRad = (-bear + 180) * (Math.PI / 180);

        const partModelMatrix = new THREE.Matrix4()
          .makeTranslation(pCoord.x, pCoord.y, (pCoord.z ?? 0) + bobAmt)
          .multiply(new THREE.Matrix4().makeScale(ps, -ps, ps))
          .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
          .multiply(new THREE.Matrix4().makeRotationY(bearingRad))
          .multiply(new THREE.Matrix4().makeRotationZ(this.leanAngles[i]));

        this.camera.projectionMatrix = new THREE.Matrix4()
          .copy(mapMatrix)
          .multiply(partModelMatrix);

        // Isolate this part for the render pass
        this.trainParts.forEach((p, j) => { p.group.visible = j === i; });
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
      });

      // Restore visibility
      this.trainParts.forEach(p => { p.group.visible = true; });

    } else {
      // ── Single model ─────────────────────────────────────────────────────

      if (this.outgoing) {
        const t = Math.min((now - this.outgoingAnimStart) / 180, 1);
        this.outgoing.scale.setScalar(1 - t);
        if (t >= 1) { this.scene.remove(this.outgoing); this.outgoing = null; }
      }
      if (this.model && this.modelAnimStart > 0) {
        const t = Math.min((now - this.modelAnimStart) / 280, 1);
        this.model.scale.setScalar(Math.max(0, easeOutBack(t)));
        if (t >= 1) this.modelAnimStart = 0;
      }

      // Auto-trigger disappear when single model reaches the end
      if (this.progress >= 1 && this.singleDisappearStart === 0) {
        this.singleDisappearStart = now;
      }

      const coord = maplibregl.MercatorCoordinate.fromLngLat(
        { lng: this.position[0], lat: this.position[1] }, 0,
      );
      let singleDisappearScale = 1;
      if (this.singleDisappearStart > 0) {
        const t = Math.min((now - this.singleDisappearStart) / 350, 1);
        singleDisappearScale = Math.max(0, 1 - t * t);
      }
      const s = coord.meterInMercatorCoordinateUnits() * desiredMeters * singleDisappearScale;
      const bobAmt = this.bobEnabled ? Math.sin(now * 0.00785) * 0.05 * s : 0;

      let bearingDelta = this.bearing - this.prevBearing;
      if (bearingDelta > 180) bearingDelta -= 360;
      if (bearingDelta < -180) bearingDelta += 360;
      this.prevBearing = this.bearing;
      const targetLean = Math.max(-0.30, Math.min(0.30, -bearingDelta * 0.05));
      this.leanAngle += (targetLean - this.leanAngle) * Math.min(1, 0.15 * (dt / 16));

      const bearingRad = (-this.bearing + 180) * (Math.PI / 180);
      const modelMatrix = new THREE.Matrix4()
        .makeTranslation(coord.x, coord.y, (coord.z ?? 0) + bobAmt)
        .multiply(new THREE.Matrix4().makeScale(s, -s, s))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
        .multiply(new THREE.Matrix4().makeRotationY(bearingRad))
        .multiply(new THREE.Matrix4().makeRotationZ(this.leanAngle));

      this.camera.projectionMatrix = new THREE.Matrix4()
        .copy(mapMatrix)
        .multiply(modelMatrix);

      this.renderer.resetState();
      this.renderer.render(this.scene, this.camera);
    }

    this.map.triggerRepaint();
  }

  onRemove() {
    if (this.model) this.scene.remove(this.model);
    if (this.outgoing) this.scene.remove(this.outgoing);
    this._clearTrainParts();
    this.renderer.dispose();
  }
}
