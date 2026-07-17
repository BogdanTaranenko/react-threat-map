/**
 * Container size tracking.
 *
 * @packageDocumentation
 */

import { useEffect, useState, type RefObject } from 'react';

/** A measured size in CSS pixels. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * Track an element's content-box size via `ResizeObserver`.
 *
 * Used only when the consumer does not pass explicit `width`/`height`, so the
 * default `<ThreatMap attacks={attacks} />` fills its container and stays
 * responsive without any layout props.
 *
 * @param ref - The element to observe.
 * @param enabled - Skip observation entirely (e.g. when size is prop-driven).
 * @returns The current size, or `null` before the first measurement.
 */
export function useElementSize(ref: RefObject<Element | null>, enabled = true): Size | null {
  const [size, setSize] = useState<Size | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const element = ref.current;
    if (!element) return;

    // SSR, jsdom without the polyfill, and very old browsers. Falling back to
    // the element's current box beats crashing.
    if (typeof ResizeObserver === 'undefined') {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      // contentRect is in CSS pixels and excludes padding/border, which is what
      // the canvas should match.
      const { width, height } = entry.contentRect;
      setSize((previous) =>
        previous && previous.width === width && previous.height === height ? previous : { width, height },
      );
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, enabled]);

  return size;
}
