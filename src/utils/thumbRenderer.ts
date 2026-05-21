import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VehicleType } from '../types';
import { getVehicle, vehicleModelUrl } from './vehicles';

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

const THUMB_SIZE = 128;

interface Job {
  vehicleType: VehicleType;
  color: string | null;
  priority: boolean;
  resolve: (url: string) => void;
}

class ThumbRenderer {
  private ren?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private cam?: THREE.PerspectiveCamera;
  private loader = new GLTFLoader();
  private texLoader = new THREE.TextureLoader();
  // Fully prepared models (ready to render)
  private modelCache = new Map<VehicleType, THREE.Group>();
  // In-flight network promises — allows all GLBs to load in parallel
  private loadingPromises = new Map<VehicleType, Promise<THREE.Group>>();
  private dataCache = new Map<string, string>();
  private queue: Job[] = [];
  private busy = false;

  private init() {
    if (this.ren) return;
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_SIZE;
    canvas.height = THUMB_SIZE;
    this.ren = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.ren.setSize(THUMB_SIZE, THUMB_SIZE);
    this.ren.setPixelRatio(1);
    this.ren.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    // Camera at 45° in XZ — front faces +Z, so this gives a true 3/4 front-right view
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    this.cam.position.set(1.8, 0.8, 1.8);
    this.cam.lookAt(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 2.5));
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.position.set(1, 2, 1);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.8);
    fill.position.set(-1, 0.5, -1);
    this.scene.add(fill);
  }

  private loadGLB(url: string): Promise<THREE.Group> {
    return new Promise((res, rej) =>
      this.loader.load(url, gltf => res(gltf.scene), undefined, rej),
    );
  }

  private loadTex(url: string): Promise<THREE.Texture> {
    return new Promise((res, rej) =>
      this.texLoader.load(url, t => {
        t.flipY = false;
        t.colorSpace = THREE.SRGBColorSpace;
        res(t);
      }, undefined, rej),
    );
  }

  // Start the network fetch for a model (deduplicates concurrent requests).
  private startLoad(type: VehicleType): Promise<THREE.Group> {
    if (this.loadingPromises.has(type)) return this.loadingPromises.get(type)!;

    const cfg = getVehicle(type);
    const url = cfg.partUrls ? cfg.partUrls[0] : vehicleModelUrl(type);

    const p = Promise.all([
      this.loadGLB(url),
      cfg.colormapUrl ? this.loadTex(cfg.colormapUrl) : Promise.resolve(null),
    ]).then(([model, colormap]) => {
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 0.001);
      model.scale.setScalar(1 / maxDim);
      model.position.set(-center.x / maxDim, -center.y / maxDim, -center.z / maxDim);

      model.traverse(child => {
        if (child instanceof THREE.Mesh) {
          (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => {
            const mat = m as THREE.MeshStandardMaterial;
            const tintable = isTintable(mat);
            mat.userData.tintable = tintable;
            mat.userData.origColor = mat.color.clone();
            console.log(
              `[ThumbRenderer] ${type} | mat="${mat.name}" tintable=${tintable}` +
              ` color=(${mat.color.r.toFixed(3)},${mat.color.g.toFixed(3)},${mat.color.b.toFixed(3)})` +
              ` metalness=${mat.metalness.toFixed(2)} roughness=${mat.roughness.toFixed(2)}` +
              ` transparent=${mat.transparent} opacity=${mat.opacity.toFixed(2)}`,
            );
            if (colormap) mat.map = colormap;
            mat.side = THREE.FrontSide;
            mat.transparent = false;
            mat.depthWrite = true;
            mat.alphaTest = 0.1;
            mat.needsUpdate = true;
          });
        }
      });

      this.modelCache.set(type, model);
      return model;
    });

    this.loadingPromises.set(type, p);
    return p;
  }

  /** Kick off parallel GLB loading for all given types — call on selector mount. */
  preload(types: VehicleType[]) {
    this.init();
    types.forEach(t => this.startLoad(t));
  }

  private getModel(type: VehicleType): Promise<THREE.Group> {
    if (this.modelCache.has(type)) return Promise.resolve(this.modelCache.get(type)!);
    return this.startLoad(type); // joins the existing in-flight promise
  }

  private async _process() {
    if (this.busy) return;
    this.busy = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      const cacheKey = `${job.vehicleType}:${job.color ?? '_'}`;

      if (this.dataCache.has(cacheKey)) {
        job.resolve(this.dataCache.get(cacheKey)!);
        continue;
      }

      try {
        this.init();
        // By the time we get here the model is usually already loaded (preloaded in parallel)
        const model = await this.getModel(job.vehicleType);

        // Temporarily apply tint to paintable materials only
        if (job.color !== null) {
          model.traverse(child => {
            if (child instanceof THREE.Mesh) {
              (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => {
                const mat = m as THREE.MeshStandardMaterial;
                if (!mat.userData.tintable) return;
                mat.color.set(job.color!);
                mat.needsUpdate = true;
              });
            }
          });
        }

        // rotation.y = 0 → front faces +Z; camera at (1.8,0.8,1.8) is 45° in XZ = 3/4 view
        model.rotation.y = 0;
        this.scene!.add(model);
        this.ren!.render(this.scene!, this.cam!);
        const dataUrl = this.ren!.domElement.toDataURL('image/png');
        this.scene!.remove(model);

        // Restore original colors
        if (job.color !== null) {
          model.traverse(child => {
            if (child instanceof THREE.Mesh) {
              (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => {
                const mat = m as THREE.MeshStandardMaterial;
                if (!mat.userData.tintable) return;
                if (mat.userData.origColor) mat.color.copy(mat.userData.origColor);
                mat.needsUpdate = true;
              });
            }
          });
        }

        this.dataCache.set(cacheKey, dataUrl);
        job.resolve(dataUrl);
      } catch (err) {
        console.warn('ThumbRenderer: failed to render', job.vehicleType, err);
        job.resolve('');
      }
    }

    this.busy = false;
  }

  get(vehicleType: VehicleType, color: string | null = null, priority = false): Promise<string> {
    const key = `${vehicleType}:${color ?? '_'}`;
    if (this.dataCache.has(key)) return Promise.resolve(this.dataCache.get(key)!);
    return new Promise(resolve => {
      const job: Job = { vehicleType, color, priority, resolve };
      if (priority) {
        this.queue.unshift(job);
      } else {
        this.queue.push(job);
      }
      this._process();
    });
  }
}

let _instance: ThumbRenderer | null = null;

export function getThumbRenderer(): ThumbRenderer {
  if (!_instance) _instance = new ThumbRenderer();
  return _instance;
}
