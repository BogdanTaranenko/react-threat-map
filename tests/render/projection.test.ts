import { geoOrthographic } from 'd3-geo';
import { describe, expect, it } from 'vitest';

import { createProjection, defaultHeightFor } from '../../src/render/projection.js';
import type { GeoProjectionLike, ProjectionName } from '../../src/types.js';

const NAMES: ProjectionName[] = ['naturalEarth1', 'equirectangular', 'mercator', 'orthographic'];

describe('createProjection', () => {
  it.each(NAMES)('builds %s and fits it inside the viewport', (name) => {
    const projection = createProjection(name, 800, 400);

    // Every land coordinate must land inside the box we fitted to.
    for (const point of [
      [0, 0],
      [2.35, 48.86],
      [-118.24, 34.05],
      [139.69, 35.68],
    ] as [number, number][]) {
      const projected = projection(point);
      if (!projected) continue; // orthographic hides half the globe
      expect(projected[0]).toBeGreaterThanOrEqual(-1);
      expect(projected[0]).toBeLessThanOrEqual(801);
      expect(projected[1]).toBeGreaterThanOrEqual(-1);
      expect(projected[1]).toBeLessThanOrEqual(401);
    }
  });

  it('falls back to naturalEarth1 for an unknown name', () => {
    const fallback = createProjection('mollweide' as ProjectionName, 800, 400);
    const expected = createProjection('naturalEarth1', 800, 400);

    expect(fallback([10, 20])).toEqual(expected([10, 20]));
  });

  it('fits to the sphere, so framing does not depend on which geometry loaded', () => {
    // Two calls at the same size must agree exactly — the map must not shift
    // when boundary data arrives or state borders toggle.
    const a = createProjection('naturalEarth1', 800, 400);
    const b = createProjection('naturalEarth1', 800, 400);
    expect(a([2.35, 48.86])).toEqual(b([2.35, 48.86]));
  });

  it('rescales with the viewport', () => {
    const small = createProjection('equirectangular', 400, 200);
    const large = createProjection('equirectangular', 800, 400);

    const smallPoint = small([180, 0])!;
    const largePoint = large([180, 0])!;
    expect(largePoint[0]).toBeCloseTo(smallPoint[0] * 2, 0);
  });

  it('accepts a d3-geo projection instance and fits it', () => {
    const custom = geoOrthographic().rotate([-10, -20]) as unknown as GeoProjectionLike;
    const fitted = createProjection(custom, 500, 500);

    const projected = fitted([-10, -20]);
    expect(projected).not.toBeNull();
    expect(Number.isFinite(projected![0])).toBe(true);
  });

  it('respects the framing of a projection with no fitExtent', () => {
    // A bare function is a legal ProjectionSpec; it must be used as-is.
    const bare = ((p: [number, number]) => [p[0] * 3, p[1] * 3] as [number, number]) as unknown as GeoProjectionLike;
    const result = createProjection(bare, 800, 400);
    expect(result([10, 10])).toEqual([30, 30]);
  });

  it('survives a projection whose fitExtent throws', () => {
    const throwing = Object.assign((p: [number, number]) => p, {
      fitExtent: () => {
        throw new Error('cannot fit');
      },
    }) as unknown as GeoProjectionLike;

    // A slightly mis-framed map beats a crashed render.
    expect(() => createProjection(throwing, 800, 400)).not.toThrow();
  });

  it('does not throw at degenerate sizes', () => {
    for (const [w, h] of [[0, 0], [1, 1], [-5, -5]]) {
      expect(() => createProjection('naturalEarth1', w as number, h as number)).not.toThrow();
    }
  });
});

describe('defaultHeightFor', () => {
  it('gives a 2:1 world map for the equirectangular family', () => {
    expect(defaultHeightFor('naturalEarth1', 800)).toBe(400);
    expect(defaultHeightFor('equirectangular', 800)).toBe(400);
  });

  it('gives a square box for orthographic, which is a globe', () => {
    expect(defaultHeightFor('orthographic', 500)).toBe(500);
  });

  it('gives mercator a taller box than a 2:1 map', () => {
    expect(defaultHeightFor('mercator', 800)).toBeGreaterThan(400);
  });

  it('falls back to 2:1 for a custom projection instance', () => {
    const custom = geoOrthographic() as unknown as GeoProjectionLike;
    expect(defaultHeightFor(custom, 800)).toBe(400);
  });
});
