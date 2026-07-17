/**
 * Projection construction and viewport fitting.
 *
 * @packageDocumentation
 */

import { geoEquirectangular, geoMercator, geoNaturalEarth1, geoOrthographic } from 'd3-geo';

import type { GeoProjectionLike, ProjectionName, ProjectionSpec } from '../types.js';

type Factory = () => GeoProjectionLike;

const factories: Readonly<Record<ProjectionName, Factory>> = Object.freeze({
  naturalEarth1: () => geoNaturalEarth1() as unknown as GeoProjectionLike,
  equirectangular: () => geoEquirectangular() as unknown as GeoProjectionLike,
  mercator: () => geoMercator() as unknown as GeoProjectionLike,
  orthographic: () => geoOrthographic() as unknown as GeoProjectionLike,
});

/**
 * Height-to-width ratio for each projection at world extent.
 *
 * Used to derive a sensible height when a consumer gives only a width. These are
 * the natural aspect ratios of each projection's world bounding box; using them
 * means the default map fills its box without letterboxing.
 */
const aspectRatios: Readonly<Record<ProjectionName, number>> = Object.freeze({
  naturalEarth1: 0.5,
  equirectangular: 0.5,
  // Mercator is infinite at the poles, so it is clipped to ~±85° — which is
  // very nearly square.
  mercator: 0.72,
  orthographic: 1,
});

/** Height-to-width ratio for a projection. Falls back to 2:1 for custom projections. */
function ratioFor(spec: ProjectionSpec): number {
  return typeof spec === 'string' ? (aspectRatios[spec] ?? 0.5) : 0.5;
}

/** The default height for a given width, when `height` is not supplied. */
export function defaultHeightFor(spec: ProjectionSpec, width: number): number {
  return Math.round(width * ratioFor(spec));
}

/**
 * The projection's aspect ratio as a CSS `aspect-ratio` value (width / height).
 *
 * Used to give the wrapper a height when the consumer supplies neither `height`
 * nor their own CSS height. This has to be done in CSS rather than JS because of
 * a genuine circularity: the canvases are absolutely positioned, so they add no
 * height to the wrapper; the wrapper would measure 0 tall; a 0-height map
 * renders no canvases; and it never escapes. `aspect-ratio` lets the browser
 * derive the height from the width before anything is measured, which breaks the
 * cycle at the layout layer where it belongs.
 */
export function aspectRatioFor(spec: ProjectionSpec): number {
  return 1 / ratioFor(spec);
}

/** The whole globe, as the GeoJSON object d3 uses for extent fitting. */
const SPHERE = { type: 'Sphere' } as const;

/**
 * Build a projection fitted to the viewport.
 *
 * Fitting to `{type: 'Sphere'}` rather than to the country geometry is
 * deliberate: it makes the framing depend only on the projection and the
 * viewport, so the map does not shift when boundary data loads, when a consumer
 * swaps in their own geo, or when state borders are toggled. It also means the
 * projection is ready *before* geometry arrives, so threats can render on an
 * empty map while the geo chunk is still in flight.
 *
 * @param spec - A projection name, or a d3-geo projection instance to fit.
 * @param width - Viewport width in CSS pixels.
 * @param height - Viewport height in CSS pixels.
 * @returns A projection fitted to the viewport.
 */
export function createProjection(spec: ProjectionSpec, width: number, height: number): GeoProjectionLike {
  const projection = typeof spec === 'string' ? (factories[spec] ?? factories.naturalEarth1)() : spec;

  // A consumer-supplied projection may legitimately lack fitExtent (a custom
  // function, a mock). Respect whatever framing it already has.
  if (typeof projection.fitExtent !== 'function') return projection;

  const w = Math.max(1, width);
  const h = Math.max(1, height);

  try {
    return projection.fitExtent(
      [
        [0, 0],
        [w, h],
      ],
      SPHERE,
    );
  } catch {
    // Some projections throw when fitting a Sphere at degenerate sizes. A
    // slightly mis-framed map beats a crashed render.
    return projection;
  }
}
