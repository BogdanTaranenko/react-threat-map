import { geoEquirectangular } from 'd3-geo';
import { describe, expect, it } from 'vitest';

import { buildArc, pointAt } from '../../src/render/path.js';
import { resolveEasing, easings } from '../../src/render/easing.js';
import type { GeoProjectionLike } from '../../src/types.js';

/** A plain 960x480 equirectangular projection: lng/lat map linearly to x/y. */
const projection = geoEquirectangular()
  .translate([480, 240])
  .scale(960 / (2 * Math.PI)) as unknown as GeoProjectionLike;

const PARIS = { lat: 48.86, lng: 2.35 };
const NYC = { lat: 40.71, lng: -74.01 };
const TOKYO = { lat: 35.68, lng: 139.69 };
const LA = { lat: 34.05, lng: -118.24 };

const at = (geometry: NonNullable<ReturnType<typeof buildArc>>, t: number) => {
  const out = new Float32Array(2);
  pointAt(geometry, t, out);
  return { x: out[0] as number, y: out[1] as number };
};

describe('buildArc', () => {
  it('produces segments + 1 points', () => {
    const arc = buildArc(PARIS, NYC, projection, 0.2, 48);
    expect(arc?.points).toHaveLength(49 * 2);
    expect(arc?.distances).toHaveLength(49);
  });

  it('starts and ends exactly at the projected endpoints', () => {
    const arc = buildArc(PARIS, NYC, projection, 0.3, 48)!;
    const [px, py] = projection([PARIS.lng, PARIS.lat])!;
    const [nx, ny] = projection([NYC.lng, NYC.lat])!;

    // The sine lift is zero at both ends, so curvature must not move endpoints.
    expect(arc.points[0]).toBeCloseTo(px, 3);
    expect(arc.points[1]).toBeCloseTo(py, 3);
    expect(arc.points[arc.points.length - 2]).toBeCloseTo(nx, 3);
    expect(arc.points[arc.points.length - 1]).toBeCloseTo(ny, 3);
  });

  it('bows away from the chord, peaking at the midpoint', () => {
    const straight = buildArc(PARIS, NYC, projection, 0, 48)!;
    const curved = buildArc(PARIS, NYC, projection, 0.3, 48)!;

    const straightMid = at(straight, 0.5);
    const curvedMid = at(curved, 0.5);
    const deviation = Math.hypot(curvedMid.x - straightMid.x, curvedMid.y - straightMid.y);

    expect(deviation).toBeGreaterThan(10);
  });

  it('bows the opposite way for negative curvature', () => {
    const up = at(buildArc(PARIS, NYC, projection, 0.3, 48)!, 0.5);
    const down = at(buildArc(PARIS, NYC, projection, -0.3, 48)!, 0.5);
    const flat = at(buildArc(PARIS, NYC, projection, 0, 48)!, 0.5);

    // The two lifts should land on opposite sides of the flat chord.
    expect(Math.sign(up.y - flat.y)).toBe(-Math.sign(down.y - flat.y));
  });

  it('scales arc height with curvature', () => {
    const flat = at(buildArc(PARIS, NYC, projection, 0, 48)!, 0.5);
    const small = at(buildArc(PARIS, NYC, projection, 0.1, 48)!, 0.5);
    const big = at(buildArc(PARIS, NYC, projection, 0.4, 48)!, 0.5);

    const dSmall = Math.hypot(small.x - flat.x, small.y - flat.y);
    const dBig = Math.hypot(big.x - flat.x, big.y - flat.y);
    expect(dBig).toBeGreaterThan(dSmall);
  });

  it('accumulates a positive total length', () => {
    const arc = buildArc(PARIS, NYC, projection, 0.2, 48)!;
    expect(arc.length).toBeGreaterThan(0);
    expect(arc.distances[0]).toBe(0);
    expect(arc.distances[arc.distances.length - 1]).toBeCloseTo(arc.length, 4);
  });

  it('produces monotonically non-decreasing cumulative distances', () => {
    const arc = buildArc(TOKYO, LA, projection, 0.25, 48)!;
    for (let i = 1; i < arc.distances.length; i++) {
      expect(arc.distances[i]!).toBeGreaterThanOrEqual(arc.distances[i - 1]!);
    }
  });

  it('produces only finite coordinates', () => {
    const arc = buildArc(TOKYO, LA, projection, 0.3, 48)!;
    for (const value of arc.points) expect(Number.isFinite(value)).toBe(true);
  });

  it('clamps segments to a sane minimum', () => {
    const arc = buildArc(PARIS, NYC, projection, 0.2, 0)!;
    expect(arc.points.length).toBeGreaterThanOrEqual(3 * 2);
  });

  describe('maxLift', () => {
    it('caps how far a long arc bows off the chord', () => {
      // Without a cap, an intercontinental arc at the default curvature lifts
      // far enough to leave the viewport and be clipped against the top edge.
      const uncapped = buildArc(TOKYO, PARIS, projection, 0.5, 48)!;
      const capped = buildArc(TOKYO, PARIS, projection, 0.5, 48, 20)!;
      const flat = buildArc(TOKYO, PARIS, projection, 0, 48)!;

      const deviation = (arc: NonNullable<ReturnType<typeof buildArc>>) => {
        const mid = at(arc, 0.5);
        const flatMid = at(flat, 0.5);
        return Math.hypot(mid.x - flatMid.x, mid.y - flatMid.y);
      };

      expect(deviation(capped)).toBeLessThanOrEqual(21);
      expect(deviation(uncapped)).toBeGreaterThan(deviation(capped));
    });

    it('leaves a short arc untouched when its natural lift is under the cap', () => {
      const uncapped = buildArc(PARIS, NYC, projection, 0.1, 48)!;
      const capped = buildArc(PARIS, NYC, projection, 0.1, 48, 10_000)!;

      expect(at(capped, 0.5)).toEqual(at(uncapped, 0.5));
    });

    it('caps a negative curvature by magnitude, preserving its direction', () => {
      const flat = buildArc(TOKYO, PARIS, projection, 0, 48)!;
      const capped = buildArc(TOKYO, PARIS, projection, -0.5, 48, 20)!;

      const flatMid = at(flat, 0.5);
      const cappedMid = at(capped, 0.5);
      const deviation = Math.hypot(cappedMid.x - flatMid.x, cappedMid.y - flatMid.y);

      expect(deviation).toBeLessThanOrEqual(21);
      expect(deviation).toBeGreaterThan(1); // still bowed, just bounded
    });

    it('defaults to no cap', () => {
      const explicit = buildArc(TOKYO, PARIS, projection, 0.3, 48, Infinity)!;
      const implicit = buildArc(TOKYO, PARIS, projection, 0.3, 48)!;
      expect(at(implicit, 0.5)).toEqual(at(explicit, 0.5));
    });
  });

  describe('antimeridian', () => {
    it('flags the seam on a path that wraps', () => {
      // Tokyo -> LA crosses the Pacific; the great circle runs over the dateline.
      const arc = buildArc(TOKYO, LA, projection, 0.2, 48)!;
      expect(arc.breakAt).toBeGreaterThan(0);
    });

    it('does not flag a seam on a path that stays within the map', () => {
      const arc = buildArc(PARIS, NYC, projection, 0.2, 48)!;
      expect(arc.breakAt).toBe(-1);
    });

    it('excludes the seam jump from the measured length', () => {
      const wrapping = buildArc(TOKYO, LA, projection, 0, 48)!;
      // Without excluding it, the seam alone would add ~900px of phantom length
      // to a path whose real on-screen pieces are far shorter.
      expect(wrapping.length).toBeLessThan(900);
    });
  });

  describe('unprojectable input', () => {
    it('returns null when an endpoint cannot be projected', () => {
      const nowhere: GeoProjectionLike = (() => null) as unknown as GeoProjectionLike;
      expect(buildArc(PARIS, NYC, nowhere, 0.2, 48)).toBeNull();
    });

    it('returns null when a projection yields non-finite output', () => {
      const broken = (() => [NaN, NaN]) as unknown as GeoProjectionLike;
      expect(buildArc(PARIS, NYC, broken, 0.2, 48)).toBeNull();
    });

    it('degrades to a chord when only intermediate samples are unprojectable', () => {
      // Mimics an orthographic globe: endpoints visible, middle over the horizon.
      let call = 0;
      const partial = ((p: [number, number]) => {
        call++;
        // First two calls are the endpoint probes; then fail the middle third.
        if (call > 2 && call < 20) return null;
        return [p[0] * 2, p[1] * 2] as [number, number];
      }) as unknown as GeoProjectionLike;

      const arc = buildArc(PARIS, NYC, partial, 0.2, 48);
      expect(arc).not.toBeNull();
      for (const value of arc!.points) expect(Number.isFinite(value)).toBe(true);
    });
  });
});

describe('pointAt', () => {
  it('returns the start at t=0 and the end at t=1', () => {
    const arc = buildArc(PARIS, NYC, projection, 0.2, 48)!;

    const start = at(arc, 0);
    const end = at(arc, 1);

    expect(start.x).toBeCloseTo(arc.points[0] as number, 3);
    expect(end.x).toBeCloseTo(arc.points[arc.points.length - 2] as number, 3);
  });

  it('clamps out-of-range progress instead of reading past the buffer', () => {
    const arc = buildArc(PARIS, NYC, projection, 0.2, 48)!;

    expect(at(arc, -5)).toEqual(at(arc, 0));
    expect(at(arc, 5)).toEqual(at(arc, 1));
    for (const t of [NaN, Infinity, -Infinity]) {
      const p = at(arc, t);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });

  it('never doubles back on itself', () => {
    const arc = buildArc(PARIS, NYC, projection, 0.2, 48)!;
    const start = at(arc, 0);
    let previousDistance = -1;

    // Distance from the start must never decrease along a bowed arc like this.
    for (let i = 0; i <= 200; i++) {
      const current = at(arc, i / 200);
      const distance = Math.hypot(current.x - start.x, current.y - start.y);
      expect(distance).toBeGreaterThanOrEqual(previousDistance - 1e-6);
      previousDistance = distance;
    }
  });

  it('traces a total travel matching the measured arc length', () => {
    const arc = buildArc(PARIS, NYC, projection, 0.2, 48)!;
    const steps = 2000; // Well above the 48 segments, so chord error is negligible.
    let previous = at(arc, 0);
    let travelled = 0;

    for (let i = 1; i <= steps; i++) {
      const current = at(arc, i / steps);
      travelled += Math.hypot(current.x - previous.x, current.y - previous.y);
      previous = current;
    }

    expect(travelled).toBeCloseTo(arc.length, 1);
  });

  it('moves at an even pixel pace rather than an even index step', () => {
    const arc = buildArc(TOKYO, PARIS, projection, 0.25, 48)!;
    const steps = 20;
    const deltas: number[] = [];

    let previous = at(arc, 0);
    for (let i = 1; i <= steps; i++) {
      const current = at(arc, i / steps);
      deltas.push(Math.hypot(current.x - previous.x, current.y - previous.y));
      previous = current;
    }

    // Every equal-t step should cover a near-equal pixel distance.
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    for (const d of deltas) expect(Math.abs(d - mean)).toBeLessThan(mean * 0.5);
  });

  it('handles a degenerate zero-length arc', () => {
    const arc = buildArc(PARIS, PARIS, projection, 0.2, 48)!;
    const point = at(arc, 0.5);
    expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
  });

  it('writes into the caller buffer without allocating', () => {
    const arc = buildArc(PARIS, NYC, projection, 0.2, 48)!;
    const out = new Float32Array(2);

    pointAt(arc, 0.5, out);
    const first = [out[0], out[1]];
    pointAt(arc, 0.9, out);

    expect([out[0], out[1]]).not.toEqual(first);
  });
});

describe('buildArc — self-loops', () => {
  /** A viewport-sized lift ceiling, as `useThreatAnimation` passes (height / 3). */
  const CEILING = 160;

  const anchor = () => projection([PARIS.lng, PARIS.lat]) as [number, number];
  const lastIndex = (arc: NonNullable<ReturnType<typeof buildArc>>) => arc.distances.length - 1;

  it('gives a same-place threat real length to travel', () => {
    const arc = buildArc(PARIS, PARIS, projection, 0.2, 48, CEILING)!;
    // The whole point: a zero-length arc is skipped by `appendPolyline`, so
    // without this the threat is invisible except for its head dot.
    expect(arc.length).toBeGreaterThan(0);
  });

  it('anchors both ends of the loop on the shared point', () => {
    const arc = buildArc(PARIS, PARIS, projection, 0.2, 48, CEILING)!;
    const [ax, ay] = anchor();
    const last = lastIndex(arc);

    // Start: where the origin marker is drawn.
    expect(arc.points[0]).toBeCloseTo(ax, 4);
    expect(arc.points[1]).toBeCloseTo(ay, 4);
    // End: where the impact ripple fires. A loop closes, so they coincide.
    expect(arc.points[last * 2]).toBeCloseTo(ax, 4);
    expect(arc.points[last * 2 + 1]).toBeCloseTo(ay, 4);
  });

  it('keeps every sample within a small radius of the anchor', () => {
    const arc = buildArc(PARIS, PARIS, projection, 0.2, 48, CEILING)!;
    const [ax, ay] = anchor();

    for (let i = 0; i <= lastIndex(arc); i++) {
      const distance = Math.hypot((arc.points[i * 2] as number) - ax, (arc.points[i * 2 + 1] as number) - ay);
      // Two radii is the far side of the loop; the cap guards against a loop
      // that scales away with the viewport and swamps the map.
      expect(distance).toBeLessThanOrEqual(40);
    }
  });

  it('walks the head around the loop rather than pinning it in place', () => {
    const arc = buildArc(PARIS, PARIS, projection, 0.2, 48, CEILING)!;
    const quarter = at(arc, 0.25);
    const threeQuarters = at(arc, 0.75);

    expect(Math.hypot(quarter.x - threeQuarters.x, quarter.y - threeQuarters.y)).toBeGreaterThan(1);
  });

  it('scales the loop with the lift ceiling, between bounds', () => {
    const tiny = buildArc(PARIS, PARIS, projection, 0.2, 48, 60)!;
    const huge = buildArc(PARIS, PARIS, projection, 0.2, 48, 4000)!;

    expect(huge.length).toBeGreaterThan(tiny.length);
    // Both clamp, so neither collapses nor runs away.
    expect(tiny.length).toBeGreaterThan(0);
    expect(huge.length).toBeLessThan(200);
  });

  it('still produces a loop with no lift ceiling supplied', () => {
    const arc = buildArc(PARIS, PARIS, projection, 0.2, 48)!;
    expect(arc.length).toBeGreaterThan(0);
  });

  it('treats a sub-pixel separation as the same place', () => {
    // ~0.001 px apart once projected: a real chord, but nothing anyone can see.
    const nudged = { lat: PARIS.lat + 0.0005, lng: PARIS.lng };
    const arc = buildArc(PARIS, nudged, projection, 0.2, 48, CEILING)!;

    expect(arc.length).toBeGreaterThan(10);
  });

  it('leaves an ordinary two-place arc alone', () => {
    const arc = buildArc(PARIS, NYC, projection, 0.2, 48, CEILING)!;
    const [px, py] = projection([PARIS.lng, PARIS.lat]) as [number, number];
    const [nx, ny] = projection([NYC.lng, NYC.lat]) as [number, number];
    const last = lastIndex(arc);

    expect(arc.points[0]).toBeCloseTo(px, 4);
    expect(arc.points[1]).toBeCloseTo(py, 4);
    expect(arc.points[last * 2]).toBeCloseTo(nx, 4);
    expect(arc.points[last * 2 + 1]).toBeCloseTo(ny, 4);
  });
});

describe('resolveEasing', () => {
  it('resolves every built-in name', () => {
    for (const name of Object.keys(easings) as (keyof typeof easings)[]) {
      const fn = resolveEasing(name);
      expect(fn(0)).toBeCloseTo(0, 5);
      expect(fn(1)).toBeCloseTo(1, 5);
    }
  });

  it('keeps built-in easings within [0, 1] across the domain', () => {
    for (const name of Object.keys(easings) as (keyof typeof easings)[]) {
      for (let t = 0; t <= 1; t += 0.1) {
        const value = resolveEasing(name)(t);
        expect(value, `${name}(${t})`).toBeGreaterThanOrEqual(-1e-9);
        expect(value, `${name}(${t})`).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('accepts a custom function', () => {
    expect(resolveEasing((t) => t * t)(0.5)).toBeCloseTo(0.25, 5);
  });

  it('clamps a custom easing that escapes [0, 1]', () => {
    // An unclamped return would become an out-of-range index downstream.
    expect(resolveEasing(() => 50)(0.5)).toBe(1);
    expect(resolveEasing(() => -50)(0.5)).toBe(0);
  });

  it('falls back to the input when a custom easing returns garbage', () => {
    expect(resolveEasing(() => NaN)(0.5)).toBe(0.5);
  });

  it('falls back to linear for an unknown name', () => {
    expect(resolveEasing('nope' as never)(0.42)).toBe(0.42);
  });
});
