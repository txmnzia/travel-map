import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import maplibregl from 'maplibre-gl';

/**
 * MapLibre custom layer that renders a GLTF/GLB vehicle model in 3D map space.
 * The model is positioned at a geographic coordinate and rotated to face a bearing.
 *
 * Not typed as `implements CustomLayerInterface` because MapLibre v4 uses gl-matrix's
 * `mat4` (an IndexedCollection) for the render matrix, which doesn't extend number[].
 * We accept the layer as `unknown` at the map.addLayer call site instead.
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
  private scaleMeters = 30;

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
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  loadModel(url: string, scaleMeters: number) {
    if (url === this.loadingUrl) return;
    this.loadingUrl = url;
    this.scaleMeters = scaleMeters;

    if (this.model) {
      this.scene.remove(this.model);
      this.model = null;
    }

    this.loader.load(
      url,
      (gltf) => {
        if (this.loadingUrl !== url) return; // superseded by a newer loadModel call
        this.model = gltf.scene;
        this.scene.add(this.model);
        this.map?.triggerRepaint();
      },
      undefined,
      (err) => console.warn('VehicleLayer: failed to load', url, err),
    );
  }

  // matrix is MapLibre's mat4 (IndexedCollection / Float32Array at runtime)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(_gl: unknown, matrix: any) {
    if (!this.model) return;

    const coord = maplibregl.MercatorCoordinate.fromLngLat(
      { lng: this.position[0], lat: this.position[1] },
      0,
    );

    const s = coord.meterInMercatorCoordinateUnits() * this.scaleMeters;

    // Build model-to-world matrix:
    // 1. Translate to Mercator position
    // 2. Scale (Y flipped — Mercator Y increases southward)
    // 3. rotateX(PI/2): lay model flat (GLTF is Y-up, map ground is XY)
    // 4. rotateY: bearing. MapLibre bearing is CW from N; Three.js Y is CCW → negate.
    const bearingRad = -this.bearing * (Math.PI / 180);
    const modelMatrix = new THREE.Matrix4()
      .makeTranslation(coord.x, coord.y, coord.z ?? 0)
      .multiply(new THREE.Matrix4().makeScale(s, -s, s))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
      .multiply(new THREE.Matrix4().makeRotationY(bearingRad));

    this.camera.projectionMatrix = new THREE.Matrix4()
      .fromArray(Array.from(matrix) as number[])
      .multiply(modelMatrix);

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.map.triggerRepaint();
  }

  onRemove() {
    if (this.model) this.scene.remove(this.model);
    this.renderer.dispose();
  }
}
