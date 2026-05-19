import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import maplibregl from 'maplibre-gl';

/**
 * MapLibre custom layer that renders a GLTF/GLB vehicle model in 3D map space.
 *
 * Scale is computed per-frame to maintain a consistent ~80 CSS-pixel apparent
 * width at any zoom level, so the vehicle is always clearly visible whether the
 * camera is watching a 10 km route or a 5 000 km route.
 *
 * Each loaded model is normalised to a 1-unit bounding box so the pixel-size
 * math works the same regardless of how the original GLB was scaled.
 */
export class VehicleLayer {
  readonly id = 'vehicle-layer';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map!: maplibregl.Map;
  private scene!: THREE.Scene;
  private camera!: THREE.Camera;
  private renderer!: THREE.WebGLRenderer;
  private model: THREE.Object3D | null = null;
  private readonly loader = new GLTFLoader();
  private loadingUrl = '';

  /** Multiplier on top of the base 80 px target — larger vehicles can use >1 */
  scaleFactor = 1;

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

    if (this.model) {
      this.scene.remove(this.model);
      this.model = null;
    }

    this.loader.load(
      url,
      (gltf) => {
        if (this.loadingUrl !== url) return; // superseded by a newer loadModel call
        const model = gltf.scene;

        // Normalise to a 1-unit bounding box so the pixel-size formula is predictable
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) model.scale.setScalar(1 / maxDim);

        // Centre horizontally; keep the model base at y=0
        const center = box.getCenter(new THREE.Vector3());
        model.position.x -= center.x / maxDim;
        model.position.z -= center.z / maxDim;

        // Force single-sided rendering — doubleSided:true in the GLB causes
        // back-face polygons to bleed outside the silhouette as a grey halo.
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => { m.side = THREE.FrontSide; });
          }
        });

        this.model = model;
        this.scene.add(this.model);
        this.map?.triggerRepaint();
      },
      undefined,
      (err) => console.warn('VehicleLayer: failed to load', url, err),
    );
  }

  // matrix is MapLibre's mat4 — Float32Array at runtime, typed as IndexedCollection in v4
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(_gl: unknown, matrix: any) {
    if (!this.model) return;

    const coord = maplibregl.MercatorCoordinate.fromLngLat(
      { lng: this.position[0], lat: this.position[1] },
      0,
    );

    // Zoom-adaptive scale: always appear ~80 CSS pixels wide regardless of zoom.
    // Formula: at zoom Z with tile size 512, 1 px ≈ 40 075 017 / (512 × 2^Z) metres.
    const zoom = this.map.getZoom();
    const metersPerPx = 40_075_017 / (512 * Math.pow(2, zoom));
    const desiredMeters = 80 * metersPerPx * this.scaleFactor;
    const s = coord.meterInMercatorCoordinateUnits() * desiredMeters;

    // Model-to-clip matrix:
    // 1. Translate to Mercator position
    // 2. Scale (Y flipped — Mercator Y increases southward)
    // 3. rotateX(π/2): lay model flat (GLTF Y-up → map XZ ground plane)
    // 4. rotateY(-bearing): orient to face direction of travel
    const bearingRad = (-this.bearing + 180) * (Math.PI / 180);
    const modelMatrix = new THREE.Matrix4()
      .makeTranslation(coord.x, coord.y, coord.z ?? 0)
      .multiply(new THREE.Matrix4().makeScale(s, -s, s))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
      .multiply(new THREE.Matrix4().makeRotationY(bearingRad));

    this.camera.projectionMatrix = new THREE.Matrix4()
      .fromArray(matrix)          // MapLibre view-projection matrix
      .multiply(modelMatrix);     // × local model transform

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.map.triggerRepaint();
  }

  onRemove() {
    if (this.model) this.scene.remove(this.model);
    this.renderer.dispose();
  }
}
