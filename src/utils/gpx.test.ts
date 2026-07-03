import { describe, expect, it } from 'vitest';
import { parseGpx } from './gpx';

function gpxDoc(points: [number, number][], tag: 'trkpt' | 'rtept' = 'trkpt'): string {
  const pts = points
    .map(([lng, lat]) => `<${tag} lat="${lat}" lon="${lng}"></${tag}>`)
    .join('\n');
  const body = tag === 'trkpt' ? `<trk><trkseg>${pts}</trkseg></trk>` : `<rte>${pts}</rte>`;
  return `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;
}

describe('parseGpx', () => {
  it('parses track points into waypoints and segments', () => {
    const result = parseGpx(gpxDoc([[0, 0], [1, 0.5], [2, 0], [3, 0.5]]));
    expect(result).not.toBeNull();
    expect(result!.waypoints.length).toBeGreaterThanOrEqual(2);
    expect(result!.segments.length).toBe(result!.waypoints.length - 1);
    // Segments chain waypoints in order
    for (let i = 0; i < result!.segments.length; i++) {
      expect(result!.segments[i].fromId).toBe(result!.waypoints[i].id);
      expect(result!.segments[i].toId).toBe(result!.waypoints[i + 1].id);
    }
  });

  it('supports route points (rtept)', () => {
    const result = parseGpx(gpxDoc([[10, 50], [11, 51], [12, 52]], 'rtept'));
    expect(result).not.toBeNull();
    expect(result!.bounds).toEqual([[10, 50], [12, 52]]);
  });

  it('rejects malformed XML and pointless files', () => {
    expect(parseGpx('<gpx><trk><trkseg>')).toBeNull();
    expect(parseGpx('not xml at all')).toBeNull();
    expect(parseGpx(gpxDoc([[0, 0]]))).toBeNull();
  });

  it('handles very large tracks without blowing the stack (F8 regression)', () => {
    // 120k points would overflow the argument limit with Math.min(...spread)
    const pts: [number, number][] = [];
    for (let i = 0; i < 120_000; i++) {
      pts.push([i * 0.0001, Math.sin(i * 0.001)]);
    }
    const result = parseGpx(gpxDoc(pts));
    expect(result).not.toBeNull();
    expect(result!.bounds[0][0]).toBeCloseTo(0);
    expect(result!.bounds[1][0]).toBeCloseTo(11.9999, 3);
    // Simplification is best-effort (target ~15); the guarantee here is only
    // that a huge track parses without RangeError and gets massively reduced
    expect(result!.waypoints.length).toBeLessThan(100);
  });

  it('keeps segment sub-paths in forward order on self-crossing tracks (F21 regression)', () => {
    // Figure-eight-ish: passes near the origin twice
    const pts: [number, number][] = [
      [0, 0], [1, 1], [2, 0], [1, -1], [0.01, 0.01], [-1, 1], [-2, 0], [-1, -1], [0, -0.01],
    ];
    const result = parseGpx(gpxDoc(pts));
    expect(result).not.toBeNull();
    // Every segment's route must be a contiguous forward slice: its first point
    // must appear in allPts no earlier than the previous segment's first point.
    const firstIdxes = result!.segments.map(s => {
      const [lng, lat] = s.route[0];
      return pts.findIndex(p => p[0] === lng && p[1] === lat);
    });
    for (let i = 1; i < firstIdxes.length; i++) {
      expect(firstIdxes[i]).toBeGreaterThanOrEqual(firstIdxes[i - 1]);
    }
  });
});
