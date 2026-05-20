import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import maplibregl from 'maplibre-gl';

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

    const coord = maplibregl.MercatorCoordinate.fromLngLat(
      { lng: this.position[0], lat: this.position[1] },
      0,
    );

    // Zoom-adaptive scale: always appear ~80 CSS pixels wide regardless of zoom
    const zoom = this.map.getZoom();
    const metersPerPx = 40_075_017 / (512 * Math.pow(2, zoom));
    const desiredMeters = 80 * metersPerPx * this.scaleFactor * this.userScaleFactor;
    const s = coord.meterInMercatorCoordinateUnits() * desiredMeters;

    // +180° offset: GLB models face +Z which maps to south in Mercator space
    const bearingRad = (-this.bearing + 180) * (Math.PI / 180);
    const modelMatrix = new THREE.Matrix4()
      .makeTranslation(coord.x, coord.y, coord.z ?? 0)
      .multiply(new THREE.Matrix4().makeScale(s, -s, s))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
      .multiply(new THREE.Matrix4().makeRotationY(bearingRad));

    this.camera.projectionMatrix = new THREE.Matrix4()
      .fromArray(matrix)
      .multiply(modelMatrix);

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.map.triggerRepaint();
  }

  onRemove() {
    if (this.model) this.scene.remove(this.model);
    if (this.outgoing) this.scene.remove(this.outgoing);
    this.renderer.dispose();
  }
}
