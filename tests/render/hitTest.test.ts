import { geoEquirectangular } from 'd3-geo';
import { describe, expect, it } from 'vitest';

import { distanceToArcSquared, hitTest, HIT_TOLERANCE, type HitCandidate } from '../../src/render/hitTest.js';
import { buildArc, pointAt, type ArcGeometry } from '../../src/render/path.js';
import type { GeoProjectionLike } from '../../src/types.js';

const projection = geoEquirectangular()
  .translate([480, 240])
  .scale(960 / (2 * Math.PI)) as unknown as GeoProjectionLike;

const PARIS = { lat: 48.86, lng: 2.35 };
const NYC = { lat: 40.71, lng: -74.01 };
const TOKYO = { lat: 35.68, lng: 139.69 };
const SYDNEY = { lat: -33.87, lng: 151.21 };

const arc = (from = PARIS, to = NYC, curvature = 0.22) => buildArc(from, to, projection, curvature, 48)!;

/** A point exactly on the arc at progress t. */
const on = (geometry: ArcGeometry, t: number) => {
  const out = new Float32Array(2);
  pointAt(geometry, t, out);
  return { x: out[0] as number, y: out[1] as number };
};

const candidate = (value: string, geometry: ArcGeometry, intensity = 1): HitCandidate<string> => ({
  value,
  geometry,
  intensity,
});

describe('distanceToArcSquared', () => {
  it('is ~zero for a point sitting on the arc', () => {
    const geometry = arc();
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const point = on(geometry, t);
      expect(distanceToArcSquared(geometry, point.x, point.y, 10), `t=${t}`).toBeLessThan(1);
    }
  });

  it('grows with distance from the arc', () => {
    const geometry = arc();
    const point = on(geometry, 0.5);

    const near = distanceToArcSquared(geometry, point.x, point.y + 3, 50);
    const far = distanceToArcSquared(geometry, point.x, point.y + 30, 50);

    expect(far).toBeGreaterThan(near);
  });

  it('measures perpendicular distance rather than distance to a vertex', () => {
    const geometry = arc(PARIS, NYC, 0); // straight chord
    const point = on(geometry, 0.5);

    // 4px off the line, but far from any endpoint: must read ~4, not ~half the chord.
    const distance = Math.sqrt(distanceToArcSquared(geometry, point.x, point.y + 4, 20));
    expect(distance).toBeCloseTo(4, 0);
  });

  it('rejects a far-away point via the bounding box', () => {
    const geometry = arc();
    expect(distanceToArcSquared(geometry, -5000, -5000, HIT_TOLERANCE)).toBe(Infinity);
  });

  it('does not treat the antimeridian seam as part of the arc', () => {
    // Tokyo -> a point across the dateline wraps; the seam is a phantom segment
    // spanning the whole map. A click in the middle of the map must not hit it.
    const geometry = buildArc(TOKYO, { lat: 21.31, lng: -157.86 }, projection, 0, 48)!;
    expect(geometry.breakAt).toBeGreaterThan(0);

    // The seam would pass near the map centre if it were a real segment.
    const distance = distanceToArcSquared(geometry, 480, 240, HIT_TOLERANCE);
    expect(distance).toBe(Infinity);
  });

  it('misses a same-place loop from far away', () => {
    const geometry = arc(PARIS, PARIS);
    expect(distanceToArcSquared(geometry, 0, 0, HIT_TOLERANCE)).toBe(Infinity);
  });

  it('hits a same-place loop from on top of it', () => {
    // A self-directed threat used to collapse to a zero-length arc, which had no
    // segments to measure against and so could never be hovered. The loop gives
    // it real geometry, and hover has to follow.
    const geometry = arc(PARIS, PARIS);
    const point = on(geometry, 0.5);

    expect(distanceToArcSquared(geometry, point.x, point.y, HIT_TOLERANCE)).toBeLessThan(1);
  });
});

describe('hitTest', () => {
  it('finds the threat under the pointer', () => {
    const geometry = arc();
    const point = on(geometry, 0.4);

    expect(hitTest([candidate('a', geometry)], point.x, point.y, 1.2)).toBe('a');
  });

  it('returns null when the pointer is nowhere near', () => {
    const geometry = arc();
    expect(hitTest([candidate('a', geometry)], 5, 5, 1.2)).toBeNull();
  });

  it('returns null for no candidates', () => {
    expect(hitTest([], 100, 100, 1.2)).toBeNull();
  });

  it('picks the nearest arc, not the first, when several overlap', () => {
    const near = arc(PARIS, NYC, 0.22);
    const far = arc(PARIS, SYDNEY, 0.22);
    const point = on(near, 0.5);

    // 'far' is listed first; the closer arc must still win.
    expect(hitTest([candidate('far', far), candidate('near', near)], point.x, point.y, 1.2)).toBe('near');
  });

  it('gives a heavier aggregate a proportionally larger hit radius', () => {
    const geometry = arc();
    const point = on(geometry, 0.5);
    // Just outside the baseline tolerance.
    const offset = HIT_TOLERANCE + 4;

    const thin = hitTest([candidate('t', geometry, 1)], point.x, point.y + offset, 1.2);
    const thick = hitTest([candidate('t', geometry, 6)], point.x, point.y + offset, 4);

    // A thick line is visibly there, so clicking it should work.
    expect(thin).toBeNull();
    expect(thick).toBe('t');
  });

  it('hits within tolerance and misses just outside it', () => {
    const geometry = arc(PARIS, NYC, 0);
    const point = on(geometry, 0.5);
    const width = 1.2;
    const tolerance = HIT_TOLERANCE + width / 2;

    expect(hitTest([candidate('a', geometry)], point.x, point.y + tolerance - 0.5, width)).toBe('a');
    expect(hitTest([candidate('a', geometry)], point.x, point.y + tolerance + 2, width)).toBeNull();
  });

  it('works at both endpoints of the arc', () => {
    const geometry = arc();
    for (const t of [0, 1]) {
      const point = on(geometry, t);
      expect(hitTest([candidate('a', geometry)], point.x, point.y, 1.2), `t=${t}`).toBe('a');
    }
  });
});
