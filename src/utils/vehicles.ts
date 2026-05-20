import { VehicleType } from '../types';

export type VehicleCategory = 'Cars' | 'Boats' | 'Rail';

export interface VehicleConfig {
  type: VehicleType;
  label: string;
  emoji: string;
  category: VehicleCategory;
  /** Dimensionless multiplier on top of the base 80-px target size */
  scaleFactor: number;
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
  // Rail
  { type: 'locomotive',   label: 'Locomotive',   emoji: '🚂', category: 'Rail', scaleFactor: 1.5 },
  { type: 'bullet-train', label: 'Bullet Train', emoji: '🚅', category: 'Rail', scaleFactor: 1.8 },
  { type: 'tram',         label: 'Tram',         emoji: '🚊', category: 'Rail', scaleFactor: 1.4 },
  { type: 'subway',       label: 'Subway',       emoji: '🚇', category: 'Rail', scaleFactor: 1.6 },
];

export const VEHICLE_CATEGORIES: VehicleCategory[] = ['Cars', 'Boats', 'Rail'];

const DEFAULT_VEHICLE = VEHICLES[0];

export function getVehicle(type: VehicleType): VehicleConfig {
  return VEHICLES.find(v => v.type === type) ?? DEFAULT_VEHICLE;
}

export function vehicleModelUrl(type: VehicleType): string {
  // BASE_URL is injected by Vite at build time (e.g. "/travel-map/" for GitHub Pages)
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return `${base}vehicles/${type}.glb`;
}
