import { MapStyleId } from '../types';

export interface MapStyleConfig {
  id: MapStyleId;
  label: string;
  url: string;
  thumbnail: string; // emoji or color for the picker
}

export const MAP_STYLES: MapStyleConfig[] = [
  {
    id: 'bright',
    label: 'Colorful',
    url: 'https://tiles.openfreemap.org/styles/bright',
    thumbnail: '🗺️',
  },
  {
    id: 'liberty',
    label: 'Classic',
    url: 'https://tiles.openfreemap.org/styles/liberty',
    thumbnail: '🌍',
  },
  {
    id: 'positron',
    label: 'Light',
    url: 'https://tiles.openfreemap.org/styles/positron',
    thumbnail: '☁️',
  },
  {
    id: 'dark-matter',
    label: 'Dark',
    url: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    thumbnail: '🌑',
  },
  {
    id: 'voyager',
    label: 'Voyager',
    url: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
    thumbnail: '🧭',
  },
];

export function getStyleUrl(id: MapStyleId): string {
  return MAP_STYLES.find(s => s.id === id)!.url;
}
