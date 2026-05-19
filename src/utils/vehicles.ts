import { VehicleType } from '../types';

export type VehicleCategory = 'Cars' | 'Boats' | 'Ships' | 'Rail';

export interface VehicleConfig {
  type: VehicleType;
  label: string;
  emoji: string;
  category: VehicleCategory;
  /** Scale in meters — controls how large the 3D model appears on the map */
  scaleMeters: number;
}

export const VEHICLES: VehicleConfig[] = [
  // Cars & road
  { type: 'sedan',      label: 'Sedan',      emoji: '🚗', category: 'Cars',  scaleMeters: 30 },
  { type: 'suv',        label: 'SUV',         emoji: '🚙', category: 'Cars',  scaleMeters: 30 },
  { type: 'sports-car', label: 'Sports Car',  emoji: '🏎️', category: 'Cars',  scaleMeters: 30 },
  { type: 'race-car',   label: 'Race Car',    emoji: '🏎️', category: 'Cars',  scaleMeters: 30 },
  { type: 'taxi',       label: 'Taxi',        emoji: '🚕', category: 'Cars',  scaleMeters: 30 },
  { type: 'truck',      label: 'Truck',       emoji: '🚛', category: 'Cars',  scaleMeters: 40 },
  { type: 'ambulance',  label: 'Ambulance',   emoji: '🚑', category: 'Cars',  scaleMeters: 35 },
  { type: 'firetruck',  label: 'Fire Truck',  emoji: '🚒', category: 'Cars',  scaleMeters: 40 },
  // Boats
  { type: 'speedboat',  label: 'Speedboat',   emoji: '🚤', category: 'Boats', scaleMeters: 40 },
  { type: 'sailboat',   label: 'Sailboat',    emoji: '⛵', category: 'Boats', scaleMeters: 40 },
  { type: 'rowboat',    label: 'Rowboat',     emoji: '🚣', category: 'Boats', scaleMeters: 30 },
  { type: 'tugboat',    label: 'Tugboat',     emoji: '🛥️', category: 'Boats', scaleMeters: 40 },
  { type: 'fanboat',    label: 'Fan Boat',    emoji: '🛶', category: 'Boats', scaleMeters: 35 },
  // Ships
  { type: 'cargo-ship',  label: 'Cargo Ship',  emoji: '🚢', category: 'Ships', scaleMeters: 120 },
  { type: 'ocean-liner', label: 'Ocean Liner', emoji: '🛳️', category: 'Ships', scaleMeters: 150 },
  { type: 'pirate-ship', label: 'Pirate Ship', emoji: '🏴‍☠️', category: 'Ships', scaleMeters: 100 },
  // Rail
  { type: 'locomotive',   label: 'Locomotive',   emoji: '🚂', category: 'Rail', scaleMeters: 50 },
  { type: 'bullet-train', label: 'Bullet Train', emoji: '🚅', category: 'Rail', scaleMeters: 60 },
  { type: 'tram',         label: 'Tram',         emoji: '🚊', category: 'Rail', scaleMeters: 45 },
  { type: 'subway',       label: 'Subway',       emoji: '🚇', category: 'Rail', scaleMeters: 55 },
];

export const VEHICLE_CATEGORIES: VehicleCategory[] = ['Cars', 'Boats', 'Ships', 'Rail'];

const DEFAULT_VEHICLE = VEHICLES[0];

export function getVehicle(type: VehicleType): VehicleConfig {
  return VEHICLES.find(v => v.type === type) ?? DEFAULT_VEHICLE;
}

export function vehicleModelUrl(type: VehicleType): string {
  // BASE_URL is injected by Vite at build time (e.g. "/travel-map/" for GitHub Pages)
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return `${base}vehicles/${type}.glb`;
}
