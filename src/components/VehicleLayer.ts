import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import maplibregl from 'maplibre-gl';

const textureLoader = new THREE.TextureLoader();

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * MapLibre custom layer that renders a GLTF/GLB vehicle model in 3D map space.
 *
 * Scale is computed per-frame to maintain a consistent ~80 CSS-pixel apparent
 * width at any zoom level. Each loaded model is normalised to a 1-unit bounding
 * box so the pixel-size math is predictable regardless of the original GLB scale.
 *
 * Vehicle switches animate with a pop-in / pop-out scale effect.
 */
export class VehicleLayer {
  readonly id = 'vehicle-layer';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map!: maplibregl.Map;
  private scene!: THREE.Scene;
  private camera!: THREE.Camera;
  private renderer!: THREE.WebGLRenderer;

  private model: THREE.Group | null = null;    // wrapper for the incoming model
  private modelAnimStart = 0;                  // performance.now() when model appeared

  private outgoing: THREE.Group | null = null; // wrapper for the previous model (animating out)
  private outgoingAnimStart = 0;

  private readonly loader = new GLTFLoader();
  private loadingUrl = '';

  scaleFactor = 1;
  userScaleFactor = 1; // user-controlled multiplier, applied on top of per-vehicle scaleFactor
  position: [number, number] = [0, 0];
  bearing = 0;

  bobEnabled = false;

  private leanAngle = 0;
  private prevBearing = 0;
  private prevRenderTime = 0;

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

    // Send current model to outgoing (will animate out)
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

        // Normalise to a 1-unit bounding box
        const box = new THREE.Box3().setFromObject(glbScene);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) glbScene.scale.setScalar(1 / maxDim);

        // Centre horizontally; keep base at y=0
        const center = box.getCenter(new THREE.Vector3());
        glbScene.position.x -= center.x / maxDim;
        glbScene.position.z -= center.z / maxDim;

        // Opaque front-side rendering with alpha-test clipping:
        // alphaTest=0.1 discards near-transparent edge pixels (the "halo")
        // without enabling blending, so depth sorting stays correct.
        glbScene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => {
              m.side = THREE.FrontSide;
              m.transparent = false;
              m.depthWrite = true;
              (m as THREE.MeshStandardMaterial).alphaTest = 0.1;
            });
          }
        });

        // Wrap in a Group so we can animate scale without touching the model's
        // own scale (which is used for bounding-box normalisation)
        const wrapper = new THREE.Group();
        wrapper.add(glbScene);
        wrapper.scale.setScalar(0); // start invisible; animate to 1

        this.model = wrapper;
        this.modelAnimStart = performance.now();
        this.scene.add(wrapper);
        this.map?.triggerRepaint();
      },
      undefined,
      (err) => console.warn('VehicleLayer: failed to load', url, err),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(_gl: unknown, matrix: any) {
    if (!this.model && !this.outgoing) return;

    const now = performance.now();

    // Animate outgoing model shrinking to zero
    if (this.outgoing) {
      const t = Math.min((now - this.outgoingAnimStart) / 180, 1);
      this.outgoing.scale.setScalar(1 - t);
      if (t >= 1) {
        this.scene.remove(this.outgoing);
        this.outgoing = null;
      }
    }

    // Animate incoming model popping in
    if (this.model && this.modelAnimStart > 0) {
      const t = Math.min((now - this.modelAnimStart) / 280, 1);
      this.model.scale.setScalar(Math.max(0, easeOutBack(t)));
      if (t >= 1) this.modelAnimStart = 0;
    }

    const dt = this.prevRenderTime > 0 ? Math.min(now - this.prevRenderTime, 50) : 16;
    this.prevRenderTime = now;

    const coord = maplibregl.MercatorCoordinate.fromLngLat(
      { lng: this.position[0], lat: this.position[1] },
      0,
    );

    // Zoom-adaptive scale: always appear ~80 CSS pixels wide regardless of zoom
    const zoom = this.map.getZoom();
    const metersPerPx = 40_075_017 / (512 * Math.pow(2, zoom));
    const desiredMeters = 80 * metersPerPx * this.scaleFactor * this.userScaleFactor;
    const s = coord.meterInMercatorCoordinateUnits() * desiredMeters;

    // Vertical bob: water vehicles only (~800 ms period, 2.5 % of model size)
    const bobAmt = this.bobEnabled ? Math.sin(now * 0.00785) * 0.05 * s : 0;

    // Banking lean: tilt into turns proportional to bearing-change rate
    let bearingDelta = this.bearing - this.prevBearing;
    if (bearingDelta > 180) bearingDelta -= 360;
    if (bearingDelta < -180) bearingDelta += 360;
    this.prevBearing = this.bearing;
    const targetLean = Math.max(-0.30, Math.min(0.30, -bearingDelta * 0.05));
    this.leanAngle += (targetLean - this.leanAngle) * Math.min(1, 0.15 * (dt / 16));

    // +180° offset: GLB models face +Z which maps to south in Mercator space
    const bearingRad = (-this.bearing + 180) * (Math.PI / 180);
    const modelMatrix = new THREE.Matrix4()
      .makeTranslation(coord.x, coord.y, (coord.z ?? 0) + bobAmt)
      .multiply(new THREE.Matrix4().makeScale(s, -s, s))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
      .multiply(new THREE.Matrix4().makeRotationY(bearingRad))
      .multiply(new THREE.Matrix4().makeRotationZ(this.leanAngle));

    this.camera.projectionMatrix = new THREE.Matrix4()
      .fromArray(matrix)
      .multiply(modelMatrix);

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.map.triggerRepaint();
  }

  /** Load multiple GLB parts and assemble them into a single train.
   *  All parts are normalised to the first part's scale so relative
   *  proportions are preserved, then chained end-to-end along -Z.
   *  colormapUrl is injected into every material so external texture atlases
   *  (not embedded in the GLB) are applied correctly. */
  loadParts(urls: string[], scaleFactor = 1, colormapUrl?: string) {
    const key = 'parts:' + urls.join('\n');
    if (key === this.loadingUrl) return;
    this.loadingUrl = key;
    this.scaleFactor = scaleFactor;

    if (this.model) {
      if (this.outgoing) this.scene.remove(this.outgoing);
      this.outgoing = this.model;
      this.outgoingAnimStart = performance.now();
      this.model = null;
    }

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

      // Normalise all parts to the first part's (loco) scale
      const firstBox = new THREE.Box3().setFromObject(parts[0]);
      const firstSize = firstBox.getSize(new THREE.Vector3());
      const scale = 1 / Math.max(firstSize.x, firstSize.y, firstSize.z, 0.001);

      const wrapper = new THREE.Group();
      const GAP = 0.03; // gap between cars as a fraction of loco size
      let zCursor = 0;  // back edge of the last placed part

      parts.forEach((part, i) => {
        part.scale.setScalar(scale);

        part.traverse(child => {
          if (child instanceof THREE.Mesh) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => {
              const mat = m as THREE.MeshStandardMaterial;
              if (colormap) mat.map = colormap;
              mat.side = THREE.FrontSide;
              mat.transparent = false;
              mat.depthWrite = true;
              mat.alphaTest = 0.1;
              mat.needsUpdate = true;
            });
          }
        });

        // Bounding box at applied scale (position still at origin)
        const box = new THREE.Box3().setFromObject(part);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const halfZ = size.z / 2;

        part.position.x = -center.x; // centre on X axis

        if (i === 0) {
          part.position.z = -center.z; // loco centred at Z=0
          zCursor = -halfZ;
        } else {
          const desiredCenter = zCursor - GAP - halfZ;
          part.position.z = desiredCenter - center.z;
          zCursor = desiredCenter - halfZ;
        }

        wrapper.add(part);
      });

      wrapper.scale.setScalar(0);
      this.model = wrapper;
      this.modelAnimStart = performance.now();
      this.scene.add(wrapper);
      this.map?.triggerRepaint();
    }).catch(err => console.warn('VehicleLayer: failed to compose parts', err));
  }

  onRemove() {
    if (this.model) this.scene.remove(this.model);
    if (this.outgoing) this.scene.remove(this.outgoing);
    this.renderer.dispose();
  }
}
