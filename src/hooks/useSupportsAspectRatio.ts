/**
 * CSS `aspect-ratio` feature detection.
 *
 * @packageDocumentation
 */

import { useEffect, useState } from 'react';

/**
 * Whether the browser understands the CSS `aspect-ratio` property.
 *
 * `<ThreatMap>` sizes itself with `aspect-ratio` when given no height, which is
 * the only way to break the circularity described in `aspectRatioFor`. On a
 * browser that does not implement it — Safari and iOS below 15, Chrome below
 * 88, Firefox below 89 — the declaration is dropped, the wrapper collapses to
 * zero height, and the map renders nothing at all. Detecting that lets the
 * component fall back to a measured pixel height.
 *
 * @returns `true` when `aspect-ratio` is supported.
 *
 * @remarks
 * Defaults to `true` and corrects itself in an effect, rather than reading
 * `CSS.supports` during render. The default has to match what the server
 * emitted or hydration would find a different `style` attribute and warn; every
 * browser that runs the effect and disagrees is one that was going to repaint
 * anyway.
 */
export function useSupportsAspectRatio(): boolean {
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return;
    setSupported(CSS.supports('aspect-ratio', '1'));
  }, []);

  return supported;
}
