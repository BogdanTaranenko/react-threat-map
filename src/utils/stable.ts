/**
 * Value-stable config resolution.
 *
 * @packageDocumentation
 */

import { useRef } from 'react';

import { mergeDefined } from './merge.js';

/**
 * Compare two config objects by value, one level into nested plain objects.
 *
 * Functions and arrays compare by reference. That is deliberate rather than
 * lazy: a function's behaviour cannot be compared, so treating a new closure as
 * a change is the only sound choice. It is also why `renderThreat`/`renderRegion`
 * are documented as things to hoist out of render.
 *
 * One level of nesting is enough for every config this library has —
 * `theme.severityColors` is the only nested object in the set.
 *
 * @internal
 */
function configEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;

  for (const key of aKeys) {
    const av = a[key];
    const bv = b[key];
    if (Object.is(av, bv)) continue;

    if (isPlainObject(av) && isPlainObject(bv)) {
      if (!shallowEqual(av, bv)) return false;
      continue;
    }
    return false;
  }
  return true;
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge `overrides` over `defaults` and return a reference that only changes
 * when the resulting **values** change.
 *
 * This exists because `useMemo(..., [props.theme])` does not do what it looks
 * like it does. Keying on the caller's object identity is worthless for the
 * single most common way these props are written:
 *
 * ```tsx
 * <ThreatMap attacks={attacks} regions={{ showStates: true }} />
 * ```
 *
 * That literal is a new object on every render, so an identity-keyed memo
 * recomputes every render, hands a new resolved config downstream, and
 * re-triggers every effect that depends on it — including the base map's, which
 * re-rasterizes ~230 country outlines. A component that re-renders often (which
 * is exactly what a streaming attack feed causes) would pay that on every update.
 *
 * Comparing by value instead makes the common spelling free, and means consumers
 * do not have to know to hoist a config object out of render to get correct
 * performance.
 *
 * @param defaults - The complete default config.
 * @param overrides - Partial overrides. `undefined` values defer to the default.
 * @returns The resolved config, referentially stable across renders whose values match.
 *
 * @internal
 */
export function useStableConfig<T extends object>(defaults: T, overrides?: Partial<T> | null): T {
  const resolved = mergeDefined(defaults, overrides);
  const ref = useRef<T>(resolved);

  // Cheap: these objects have a handful of keys, and this runs once per render
  // in place of re-running every downstream effect.
  if (!configEqual(ref.current as Record<string, unknown>, resolved as Record<string, unknown>)) {
    ref.current = resolved;
  }

  return ref.current;
}
