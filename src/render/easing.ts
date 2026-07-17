/**
 * Easing curves for head travel.
 *
 * @packageDocumentation
 */

import type { EasingName } from '../types.js';

/** Every built-in easing, keyed by {@link EasingName}. */
export const easings: Readonly<Record<EasingName, (t: number) => number>> = Object.freeze({
  linear: (t) => t,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => t * (2 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
});

/**
 * Turn an easing name or custom function into a callable.
 *
 * A custom easing is arbitrary consumer code that runs on every threat on every
 * frame and whose output becomes an array index. An unclamped return value
 * therefore reads off the end of the geometry buffer, so the result is clamped
 * to `[0, 1]` here rather than trusted downstream.
 *
 * @param easing - A built-in name, or your own `(t: 0..1) => 0..1`.
 * @returns A function safe to call in the render loop. Unknown names fall back to linear.
 */
export function resolveEasing(easing: EasingName | ((t: number) => number)): (t: number) => number {
  if (typeof easing === 'function') {
    return (t) => {
      const eased = easing(t);
      return Number.isFinite(eased) ? Math.max(0, Math.min(1, eased)) : t;
    };
  }
  return easings[easing] ?? easings.linear;
}
