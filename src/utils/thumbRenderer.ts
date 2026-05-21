import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { VehicleType } from '../types';
import { getVehicle, vehicleModelUrl } from './vehicles';
import { extractAtlasPixels, buildTintedTexture } from './tintTexture';

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
  private fbxLoader = new FBXLoader();
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

    // FBX branch for walking characters — use separate FBXLoader instances per load
    // to avoid any shared-state issues with concurrent requests
    if (cfg.fbxUrl) {
      const p: Promise<THREE.Group> = Promise.all([
        new Promise<THREE.Group>((res, rej) => new FBXLoader().load(cfg.fbxUrl!, res, undefined, rej)),
        cfg.animUrl
          ? new Promise<THREE.Group>((res, rej) => new FBXLoader().load(cfg.animUrl!, res, undefined, rej))
          : Promise.resolve(null as unknown as THREE.Group),
        cfg.skinUrl
          ? new Promise<THREE.Texture>((res, rej) => this.texLoader.load(cfg.skinUrl!, t => {
              t.colorSpace = THREE.SRGBColorSpace; res(t);
            }, undefined, rej))
          : Promise.resolve(null as unknown as THREE.Texture),
      ]).then(([group, animGroup, skin]) => {
        const box = new THREE.Box3().setFromObject(group);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z, 0.001);
        group.scale.setScalar(1 / maxDim);
        group.position.set(-center.x / maxDim, -center.y / maxDim, -center.z / maxDim);
        group.traverse(child => {
          if (child instanceof THREE.Mesh) {
            (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => {
              const mat = m as THREE.MeshStandardMaterial;
              if (skin) mat.map = skin;
              mat.side = THREE.FrontSide;
              mat.transparent = false;
              mat.depthWrite = true;
              mat.alphaTest = 0.1;
              mat.needsUpdate = true;
            });
          }
        });
        // Skip the "Targeting Pose" bind-pose clip (index 0 in Mixamo FBX exports)
        const allClips = [...((animGroup?.animations) ?? []), ...group.animations];
        const clip = allClips.find(a => !a.name.includes('Targeting Pose')) ?? allClips[0] ?? null;
        if (clip) {
          const mixer = new THREE.AnimationMixer(group);
          mixer.clipAction(clip).play();
          mixer.update(0.4);
        }
        this.modelCache.set(type, group);
        return group;
      });
      this.loadingPromises.set(type, p);
      return p;
    }

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
            if (colormap) mat.map = colormap;
            mat.side = THREE.FrontSide;
            mat.transparent = false;
            mat.depthWrite = true;
            mat.alphaTest = 0.1;
            mat.needsUpdate = true;
            // Extract atlas pixels for texture-based tinting (done once at load)
            if (mat.map && !mat.userData.atlasData) {
              const px = extractAtlasPixels(mat.map);
              if (px) {
                mat.userData.atlasData = px.data;
                mat.userData.atlasWidth = px.width;
                mat.userData.atlasHeight = px.height;
              }
            }
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

        // Apply tint by swapping atlas texture with a recolored copy
        let tintedTex: THREE.CanvasTexture | null = null as THREE.CanvasTexture | null;
        const origMaps = new Map<THREE.MeshStandardMaterial, THREE.Texture | null>();

        if (job.color !== null) {
          model.traverse(child => {
            if (child instanceof THREE.Mesh) {
              (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => {
                const mat = m as THREE.MeshStandardMaterial;
                if (origMaps.has(mat)) return;
                origMaps.set(mat, mat.map);
                const { atlasData, atlasWidth, atlasHeight } = mat.userData;
                if (atlasData) {
                  if (!tintedTex) {
                    tintedTex = buildTintedTexture(atlasData, atlasWidth, atlasHeight, job.color!);
                  }
                  mat.map = tintedTex;
                  mat.needsUpdate = true;
                }
              });
            }
          });
        }

        // rotation.y = 0 → front faces +Z; camera at (1.8,0.8,1.8) is 45° in XZ = 3/4 view
        model.rotation.y = getVehicle(job.vehicleType).fbxUrl ? Math.PI : 0;
        this.scene!.add(model);
        this.ren!.render(this.scene!, this.cam!);
        const dataUrl = this.ren!.domElement.toDataURL('image/png');
        this.scene!.remove(model);

        // Restore original texture maps and dispose tinted copy
        origMaps.forEach((origMap, mat) => { mat.map = origMap; mat.needsUpdate = true; });
        tintedTex?.dispose();

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
