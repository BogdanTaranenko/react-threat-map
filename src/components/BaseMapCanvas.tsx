/**
 * The static base map canvas.
 *
 * @packageDocumentation
 */

import { useEffect, useRef } from 'react';

import type {
  GeoData,
  GeoProjectionLike,
  RegionRenderer,
  RegionsConfig,
  ThreatMapTheme,
} from '../types.js';
import { drawBaseMap } from '../render/drawBaseMap.js';

/** Props for {@link BaseMapCanvas}. @internal */
export interface BaseMapCanvasProps {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly projection: GeoProjectionLike | null;
  readonly geo: GeoData | null;
  readonly theme: ThreatMapTheme;
  readonly regions: RegionsConfig;
  readonly renderRegion?: RegionRenderer | undefined;
  readonly weights?: ReadonlyMap<string, number> | undefined;
  readonly onError?: ((message: string, cause: unknown) => void) | undefined;
}

/**
 * Rasterizes country and state boundaries once per layout.
 *
 * Separate from the threat canvas on purpose: this is the expensive-but-static
 * half (~230 outlines), and keeping it on its own layer means the animation loop
 * never has to touch it. See DECISIONS.md §1.
 *
 * @internal
 */
export function BaseMapCanvas(props: BaseMapCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { width, height, pixelRatio, projection, geo, theme, regions, renderRegion, weights, onError } = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !projection || width <= 0 || height <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      onError?.('Could not acquire a 2D canvas context; the base map will not render.', undefined);
      return;
    }

    // Draw in CSS pixels; the transform handles the device pixel ratio, so the
    // map stays crisp on a HiDPI display without any coordinate arithmetic.
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    drawBaseMap({ ctx, width, height, projection, geo, theme, regions, renderRegion, weights, onError });
  }, [width, height, pixelRatio, projection, geo, theme, regions, renderRegion, weights, onError]);

  return (
    <canvas
      ref={canvasRef}
      width={Math.max(1, Math.round(width * pixelRatio))}
      height={Math.max(1, Math.round(height * pixelRatio))}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      aria-hidden="true"
    />
  );
}
