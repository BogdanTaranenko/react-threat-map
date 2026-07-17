/**
 * The static base map layer.
 *
 * This runs **once per layout** — on mount, resize, and theme/projection change
 * — never per animation frame. That separation is the whole reason the base map
 * and the threats live on different canvases: ~230 country and state outlines
 * get rasterized once and are then left completely alone while the threat layer
 * animates above them. See DECISIONS.md §1.
 *
 * @packageDocumentation
 */

import { geoGraticule10, geoPath } from 'd3-geo';
import type { GeoPermissibleObjects } from 'd3-geo';

import type {
  GeoData,
  GeoFeature,
  GeoProjectionLike,
  RegionRenderer,
  RegionsConfig,
  ThreatMapTheme,
} from '../types.js';

/** Everything {@link drawBaseMap} needs. */
export interface DrawBaseMapOptions {
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  readonly projection: GeoProjectionLike;
  readonly geo: GeoData | null;
  readonly theme: ThreatMapTheme;
  readonly regions: RegionsConfig;
  /** Optional per-region override. See {@link RegionRenderer}. */
  readonly renderRegion?: RegionRenderer | undefined;
  /** Total attack weight per region id, exposed to `renderRegion` for choropleths. */
  readonly weights?: ReadonlyMap<string, number> | undefined;
  /** Reports a throwing render hook. */
  readonly onError?: ((message: string, cause: unknown) => void) | undefined;
}

/**
 * Rasterize the base map.
 *
 * @param options - See {@link DrawBaseMapOptions}.
 */
export function drawBaseMap(options: DrawBaseMapOptions): void {
  const { ctx, width, height, projection, geo, theme, regions } = options;

  ctx.clearRect(0, 0, width, height);

  // d3's geoPath writes into the canvas context directly, which is why the same
  // generator that would emit SVG path data works here with no translation layer.
  const path = geoPath(projection as never, ctx);

  drawOcean(ctx, width, height, theme, regions, path);

  if (regions.showGraticule) {
    ctx.beginPath();
    path(geoGraticule10() as GeoPermissibleObjects);
    ctx.strokeStyle = regions.graticuleColor;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  // Geometry may still be loading. The ocean/graticule above already gave us a
  // usable map, so there is nothing to wait for.
  if (!geo) return;

  if (regions.showCountries) {
    drawFeatures(options, path, geo.countries.features, theme.border, theme.borderWidth);
  }
  if (regions.showStates && geo.states) {
    // States draw over countries so their internal borders are visible; they use
    // the same fill, so only the borders read as new.
    drawFeatures(options, path, geo.states.features, theme.stateBorder, theme.stateBorderWidth);
  }
}

function drawOcean(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: ThreatMapTheme,
  regions: RegionsConfig,
  path: ReturnType<typeof geoPath>,
): void {
  if (regions.showSphere) {
    // Fill only the projected globe, so the area outside it stays transparent
    // and the consumer's own background shows through. This is what makes a
    // non-rectangular projection (orthographic, Natural Earth) look right on an
    // arbitrary page background.
    ctx.beginPath();
    path({ type: 'Sphere' } as GeoPermissibleObjects);
    ctx.fillStyle = theme.ocean;
    ctx.fill();
    return;
  }

  ctx.fillStyle = theme.ocean;
  ctx.fillRect(0, 0, width, height);
}

/**
 * Draw a set of regions.
 *
 * Batched: every feature's outline accumulates into one path, then a single
 * fill and a single stroke cover the lot. Filling per feature would issue ~180
 * fills for the countries alone. The `renderRegion` hook necessarily opts a
 * feature out of the batch, so hooked features are drawn individually.
 */
function drawFeatures(
  options: DrawBaseMapOptions,
  path: ReturnType<typeof geoPath>,
  features: readonly GeoFeature[],
  borderColor: string,
  borderWidth: number,
): void {
  const { ctx, theme, renderRegion, weights, onError } = options;

  let hookFailed = false;
  const batched: GeoFeature[] = [];

  for (const featureItem of features) {
    if (renderRegion && !hookFailed) {
      try {
        const handled = renderRegion(ctx, {
          feature: featureItem,
          id: featureItem.id,
          kind: featureItem.properties.kind,
          path: (f) => path(f as unknown as GeoPermissibleObjects),
          theme,
          weight: weights?.get(featureItem.id) ?? 0,
        });
        // `true` means the hook drew it; anything else falls through to us.
        if (handled === true) continue;
      } catch (error) {
        // One throwing hook must not take out the whole map. Disable it for the
        // rest of this pass and let the built-in renderer finish the job.
        hookFailed = true;
        onError?.('renderRegion threw; falling back to the built-in renderer.', error);
      }
    }
    batched.push(featureItem);
  }

  if (batched.length === 0) return;

  ctx.beginPath();
  for (const featureItem of batched) {
    path(featureItem as unknown as GeoPermissibleObjects);
  }

  ctx.fillStyle = theme.land;
  ctx.fill();

  if (borderWidth > 0) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidth;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}
