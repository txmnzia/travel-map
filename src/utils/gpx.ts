import * as turf from '@turf/turf';
import { Waypoint, Segment } from '../types';

export interface GpxImportResult {
  waypoints: Waypoint[];
  segments: Segment[];
  bounds: [[number, number], [number, number]]; // [sw, ne]
}

function extractPoints(xml: Document): [number, number][] {
  for (const tag of ['trkpt', 'rtept', 'wpt']) {
    const els = xml.querySelectorAll(tag);
    const pts: [number, number][] = [];
    els.forEach(el => {
      const lat = parseFloat(el.getAttribute('lat') ?? '');
      const lon = parseFloat(el.getAttribute('lon') ?? '');
      if (isFinite(lat) && isFinite(lon)) pts.push([lon, lat]);
    });
    if (pts.length > 1) return pts;
  }
  return [];
}

function adaptiveSimplify(pts: [number, number][], target = 15): [number, number][] {
  if (pts.length <= target) return pts;
  const line = turf.lineString(pts);
  let lo = 0, hi = 10;
  for (let iter = 0; iter < 24; iter++) {
    const mid = (lo + hi) / 2;
    const s = turf.simplify(line, { tolerance: mid, highQuality: false });
    if (s.geometry.coordinates.length > target) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-6) break;
  }
  const result = turf.simplify(line, { tolerance: hi, highQuality: true });
  return result.geometry.coordinates as [number, number][];
}

// Find the index of the nearest point in pts to target, searching forward from startFrom
function nearestIdxForward(
  pts: [number, number][],
  target: [number, number],
  startFrom: number,
): number {
  let best = startFrom;
  let bestDist = Infinity;
  for (let i = startFrom; i < pts.length; i++) {
    const d = (pts[i][0] - target[0]) ** 2 + (pts[i][1] - target[1]) ** 2;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

export function parseGpx(text: string): GpxImportResult | null {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror')) return null;

  const allPts = extractPoints(xml);
  if (allPts.length < 2) return null;

  const keyPts = adaptiveSimplify(allPts, 15);
  if (keyPts.length < 2) return null;

  // Plain loop, not Math.min(...spread): real-world GPX tracks can exceed the
  // engine's argument-count limit (~65k) and throw RangeError on spread.
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of allPts) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const bounds: [[number, number], [number, number]] = [
    [minLng, minLat],
    [maxLng, maxLat],
  ];

  const ts = Date.now();
  const waypoints: Waypoint[] = keyPts.map((pt, i) => ({
    id: `wp-gpx-${ts}-${i}`,
    lng: pt[0],
    lat: pt[1],
  }));

  // Build segments, using original GPX sub-paths as the route polyline
  const segments: Segment[] = [];
  let searchFrom = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];

    const fromIdx = nearestIdxForward(allPts, [from.lng, from.lat], searchFrom);
    const toIdx = nearestIdxForward(allPts, [to.lng, to.lat], fromIdx);

    const subPts = allPts.slice(fromIdx, toIdx + 1);
    const route: [number, number][] =
      subPts.length >= 2 ? subPts : [[from.lng, from.lat], [to.lng, to.lat]];

    segments.push({
      id: `seg-gpx-${ts}-${i}`,
      fromId: from.id,
      toId: to.id,
      vehicle: 'sedan',
      manualVehicle: false,
      handles: [],
      route,
    });

    // Continue the next search from this segment's end — starting from fromIdx
    // could snap a later waypoint to an earlier pass on self-crossing tracks
    searchFrom = toIdx;
  }

  return { waypoints, segments, bounds };
}
