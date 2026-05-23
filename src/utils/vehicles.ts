import { VehicleType } from '../types';

export type VehicleCategory = 'Cars' | 'Boats' | 'Rail' | 'People';

export interface VehicleConfig {
  type: VehicleType;
  label: string;
  emoji: string;
  category: VehicleCategory;
  /** Dimensionless multiplier on top of the base 80-px target size */
  scaleFactor: number;
  /** For multi-part vehicles: ordered list of GLB URLs to chain together */
  partUrls?: string[];
  /** Shared texture atlas to inject into all materials after loading */
  colormapUrl?: string;
  fbxUrl?: string;        // FBX file containing the skinned character mesh
  animUrl?: string;       // primary animation FBX (run/move)
  idleUrl?: string;       // idle animation FBX (shown when stopped)
  skinUrl?: string;       // skin texture PNG
}

function base(): string {
  return (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
}
function trainUrl(file: string): string {
  return `${base()}vehicles/_extras/train/${file}`;
}
function vehicleUrl(file: string): string {
  return `${base()}vehicles/${file}`;
}
function walkUrl(file: string): string {
  return `${base()}vehicles/walk/${file}`;
}

export const VEHICLES: VehicleConfig[] = [
  // Cars & road
  { type: 'sedan',      label: 'Sedan',      emoji: '🚗', category: 'Cars',  scaleFactor: 1.0 },
  { type: 'suv',        label: 'SUV',         emoji: '🚙', category: 'Cars',  scaleFactor: 1.0 },
  { type: 'sports-car', label: 'Sports Car',  emoji: '🏎️', category: 'Cars',  scaleFactor: 1.0 },
  { type: 'race-car',   label: 'Race Car',    emoji: '🏎️', category: 'Cars',  scaleFactor: 1.0 },
  { type: 'taxi',       label: 'Taxi',        emoji: '🚕', category: 'Cars',  scaleFactor: 1.0 },
  { type: 'truck',      label: 'Truck',       emoji: '🚛', category: 'Cars',  scaleFactor: 1.3 },
  { type: 'ambulance',  label: 'Ambulance',   emoji: '🚑', category: 'Cars',  scaleFactor: 1.1 },
  { type: 'firetruck',  label: 'Fire Truck',  emoji: '🚒', category: 'Cars',  scaleFactor: 1.3 },
  // Boats
  { type: 'speedboat',  label: 'Speedboat',   emoji: '🚤', category: 'Boats', scaleFactor: 1.2 },
  { type: 'sailboat',   label: 'Sailboat',    emoji: '⛵', category: 'Boats', scaleFactor: 1.2 },
  { type: 'rowboat',    label: 'Rowboat',     emoji: '🚣', category: 'Boats', scaleFactor: 0.9 },
  { type: 'tugboat',    label: 'Tugboat',     emoji: '🛥️', category: 'Boats', scaleFactor: 1.2 },
  { type: 'fanboat',    label: 'Fan Boat',    emoji: '🛶', category: 'Boats', scaleFactor: 1.0 },
  // Ships
  { type: 'cargo-ship',  label: 'Cargo Ship',  emoji: '🚢', category: 'Boats', scaleFactor: 2.5 },
  { type: 'ocean-liner', label: 'Ocean Liner', emoji: '🛳️', category: 'Boats', scaleFactor: 3.0 },
  { type: 'pirate-ship', label: 'Pirate Ship', emoji: '🏴‍☠️', category: 'Boats', scaleFactor: 2.0 },
  // Rail (multi-part: all parts normalised to loco scale and chained end-to-end)
  {
    type: 'locomotive', label: 'Locomotive', emoji: '🚂', category: 'Rail', scaleFactor: 1.0,
    colormapUrl: vehicleUrl('train-colormap.png'),
    partUrls: [
      trainUrl('train-locomotive-a.glb'),
      trainUrl('train-carriage-coal.glb'),
      trainUrl('train-carriage-box.glb'),
      trainUrl('train-carriage-flatbed.glb'),
      trainUrl('train-carriage-lumber.glb'),
    ],
  },
  {
    type: 'bullet-train', label: 'Bullet Train', emoji: '🚅', category: 'Rail', scaleFactor: 1.0,
    colormapUrl: vehicleUrl('train-colormap.png'),
    partUrls: [
      trainUrl('train-electric-bullet-a.glb'),
      trainUrl('train-electric-bullet-b.glb'),
      trainUrl('train-electric-bullet-b.glb'),
      trainUrl('train-electric-bullet-c.glb'),
    ],
  },
  {
    type: 'tram', label: 'Tram', emoji: '🚊', category: 'Rail', scaleFactor: 1.2,
    colormapUrl: vehicleUrl('train-colormap.png'),
    partUrls: [trainUrl('train-tram-modern.glb')],
  },
  {
    type: 'subway', label: 'Subway', emoji: '🚇', category: 'Rail', scaleFactor: 1.0,
    colormapUrl: vehicleUrl('train-colormap.png'),
    partUrls: [
      trainUrl('train-electric-subway-a.glb'),
      trainUrl('train-electric-subway-b.glb'),
      trainUrl('train-electric-subway-b.glb'),
      trainUrl('train-electric-subway-c.glb'),
    ],
  },
  { type: 'walker-criminal',  label: 'Criminal',    emoji: '😈', category: 'People', scaleFactor: 1.0, fbxUrl: walkUrl('characterMedium.fbx'), animUrl: walkUrl('run.fbx'), idleUrl: walkUrl('idle.fbx'), skinUrl: walkUrl('criminalMaleA.png')  },
  { type: 'walker-cyborg',    label: 'Cyborg',      emoji: '🤖', category: 'People', scaleFactor: 1.0, fbxUrl: walkUrl('characterMedium.fbx'), animUrl: walkUrl('run.fbx'), idleUrl: walkUrl('idle.fbx'), skinUrl: walkUrl('cyborgFemaleA.png')  },
  { type: 'walker-skater-f',  label: 'Skater Girl', emoji: '🛹', category: 'People', scaleFactor: 1.0, fbxUrl: walkUrl('characterMedium.fbx'), animUrl: walkUrl('run.fbx'), idleUrl: walkUrl('idle.fbx'), skinUrl: walkUrl('skaterFemaleA.png') },
  { type: 'walker-skater-m',  label: 'Skater Guy',  emoji: '🛹', category: 'People', scaleFactor: 1.0, fbxUrl: walkUrl('characterMedium.fbx'), animUrl: walkUrl('run.fbx'), idleUrl: walkUrl('idle.fbx'), skinUrl: walkUrl('skaterMaleA.png')  },
];

export const VEHICLE_CATEGORIES: VehicleCategory[] = ['Cars', 'Boats', 'Rail', 'People'];

const DEFAULT_VEHICLE = VEHICLES[0];

export function getVehicle(type: VehicleType): VehicleConfig {
  return VEHICLES.find(v => v.type === type) ?? DEFAULT_VEHICLE;
}

export function resolveAnimUrl(cfg: VehicleConfig): string | null {
  return cfg.animUrl ?? null;
}

export function vehicleModelUrl(type: VehicleType): string {
  // BASE_URL is injected by Vite at build time (e.g. "/travel-map/" for GitHub Pages)
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return `${base}vehicles/${type}.glb`;
}
