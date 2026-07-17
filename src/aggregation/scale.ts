/**
 * Mapping attack counts to visual weight.
 *
 * @packageDocumentation
 */

import type { IntensityScale } from '../types.js';

/** Upper bound on intensity, so one runaway group cannot black out the map. */
export const MAX_INTENSITY = 6;

/**
 * The default count → visual weight ramp: `1 + log2(count) * 0.5`, clamped to
 * `[1, 6]`.
 *
 * Logarithmic rather than linear, because attack volume per region is heavily
 * long-tailed. Linear scaling on a feed where one region sends 500 attacks and
 * another sends 5 gives you a 500 px-wide smear next to a hairline — the busiest
 * region erases the map it is drawn on. The log ramp keeps the ordering legible:
 *
 * | count | intensity |
 * | ----- | --------- |
 * | 1     | 1.0       |
 * | 2     | 1.5       |
 * | 10    | 2.7       |
 * | 100   | 4.3       |
 * | 500   | 5.5       |
 * | 5000  | 6.0 (clamped) |
 *
 * Swap it for anything you like via {@link AggregationConfig.scale} — e.g.
 * `(count) => 1 + count / 10` for a linear ramp, or `() => 1` to size every
 * threat identically while still merging them.
 *
 * @param count - Attacks in the group, `>= 1`.
 * @returns A multiplier in `[1, 6]`.
 */
export const defaultIntensityScale: IntensityScale = (count) => {
  if (!Number.isFinite(count) || count <= 1) return 1;
  const intensity = 1 + Math.log2(count) * 0.5;
  return Math.min(intensity, MAX_INTENSITY);
};

/**
 * Clamp an arbitrary consumer-supplied scale into a range the renderer can
 * survive.
 *
 * A custom `scale` is arbitrary user code: it can return `NaN`, `Infinity`,
 * negative numbers, or `1e9`. Any of those reach Canvas as a `lineWidth` and
 * either throw, silently drop the frame, or hang the tab trying to rasterize a
 * million-pixel stroke. We clamp instead of trusting.
 *
 * `NaN` is the one value that falls back to baseline `1` rather than clamping:
 * it carries no ordering information, so the safe reading is "no scaling". The
 * infinities do carry intent — `Infinity` means "as heavy as possible" — so they
 * clamp to the ends of the range instead.
 *
 * @param value - Whatever the scale returned.
 * @returns A finite multiplier within `[0, MAX_INTENSITY]`.
 *
 * @internal
 */
export function clampIntensity(value: number): number {
  if (Number.isNaN(value)) return 1;
  return Math.max(0, Math.min(value, MAX_INTENSITY));
}
