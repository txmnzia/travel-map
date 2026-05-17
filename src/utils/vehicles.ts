import { VehicleType } from '../types';

export interface VehicleConfig {
  type: VehicleType;
  label: string;
  emoji: string;
  /** SVG string, nose pointing UP (north) for correct bearing rotation */
  svg: string;
  color: string;
}

const PLANE_SVG = `<svg viewBox="0 0 64 80" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M32 4 L38 32 L64 44 L64 52 L38 44 L40 68 L48 72 L48 76 L32 72 L16 76 L16 72 L24 68 L26 44 L0 52 L0 44 L26 32 Z" fill="white" stroke="rgba(0,0,0,0.15)" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

const CAR_SVG = `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="20" y="8" width="24" height="28" rx="4" fill="white" stroke="rgba(0,0,0,0.15)" stroke-width="1.5"/>
  <rect x="14" y="24" width="36" height="24" rx="6" fill="white" stroke="rgba(0,0,0,0.15)" stroke-width="1.5"/>
  <circle cx="21" cy="50" r="6" fill="white" stroke="rgba(0,0,0,0.25)" stroke-width="2"/>
  <circle cx="43" cy="50" r="6" fill="white" stroke="rgba(0,0,0,0.25)" stroke-width="2"/>
  <rect x="22" y="12" width="20" height="14" rx="2" fill="rgba(150,200,255,0.6)" stroke="rgba(0,0,0,0.1)" stroke-width="1"/>
</svg>`;

const TRAIN_SVG = `<svg viewBox="0 0 64 80" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="16" y="6" width="32" height="52" rx="8" fill="white" stroke="rgba(0,0,0,0.15)" stroke-width="1.5"/>
  <rect x="20" y="10" width="24" height="14" rx="3" fill="rgba(150,200,255,0.6)" stroke="rgba(0,0,0,0.1)" stroke-width="1"/>
  <rect x="20" y="30" width="24" height="14" rx="3" fill="rgba(150,200,255,0.6)" stroke="rgba(0,0,0,0.1)" stroke-width="1"/>
  <circle cx="22" cy="66" r="6" fill="white" stroke="rgba(0,0,0,0.25)" stroke-width="2"/>
  <circle cx="42" cy="66" r="6" fill="white" stroke="rgba(0,0,0,0.25)" stroke-width="2"/>
  <line x1="16" y1="50" x2="48" y2="50" stroke="rgba(0,0,0,0.1)" stroke-width="1.5"/>
</svg>`;

const BICYCLE_SVG = `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="14" cy="46" r="12" fill="none" stroke="white" stroke-width="4"/>
  <circle cx="50" cy="46" r="12" fill="none" stroke="white" stroke-width="4"/>
  <path d="M14 46 L32 18 L50 46" stroke="white" stroke-width="4" stroke-linejoin="round" fill="none"/>
  <path d="M32 18 L28 46" stroke="white" stroke-width="3" fill="none"/>
  <circle cx="32" cy="16" r="5" fill="none" stroke="white" stroke-width="3"/>
  <path d="M24 18 L40 18" stroke="white" stroke-width="3" stroke-linecap="round"/>
</svg>`;

const WALK_SVG = `<svg viewBox="0 0 40 72" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="20" cy="8" r="7" fill="white" stroke="rgba(0,0,0,0.1)" stroke-width="1"/>
  <path d="M20 15 L14 38 L6 58" stroke="white" stroke-width="4" stroke-linecap="round" fill="none"/>
  <path d="M20 15 L26 38 L34 58" stroke="white" stroke-width="4" stroke-linecap="round" fill="none"/>
  <path d="M14 26 L26 26" stroke="white" stroke-width="4" stroke-linecap="round" fill="none"/>
</svg>`;

export const VEHICLES: VehicleConfig[] = [
  { type: 'plane',    label: 'Plane',    emoji: '✈️', svg: PLANE_SVG,   color: '#f5a623' },
  { type: 'car',      label: 'Car',      emoji: '🚗', svg: CAR_SVG,     color: '#f5a623' },
  { type: 'train',    label: 'Train',    emoji: '🚂', svg: TRAIN_SVG,   color: '#f5a623' },
  { type: 'bicycle',  label: 'Bicycle',  emoji: '🚲', svg: BICYCLE_SVG, color: '#f5a623' },
  { type: 'walk',     label: 'Walk',     emoji: '🚶', svg: WALK_SVG,    color: '#f5a623' },
];

export function getVehicle(type: VehicleType): VehicleConfig {
  return VEHICLES.find(v => v.type === type)!;
}
