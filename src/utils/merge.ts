/**
 * Config merging.
 *
 * @packageDocumentation
 */

/**
 * Merge an override object over defaults, **ignoring keys whose value is
 * `undefined`**.
 *
 * A plain spread does not do this. `{...defaults, ...{enabled: undefined}}`
 * yields `enabled: undefined`, silently discarding the default — and
 * `Partial<T>` permits explicit `undefined`, so this is reachable from ordinary
 * consumer code:
 *
 * ```tsx
 * <ThreatMap aggregation={{ enabled: props.enabled }} />  // undefined when unset
 * ```
 *
 * With a spread, that turns aggregation off. With this, it keeps the default.
 *
 * @param defaults - The complete base object.
 * @param overrides - Partial overrides. `undefined`, `null`, and missing keys all defer to the default.
 * @returns A new object; neither input is mutated.
 */
export function mergeDefined<T extends object>(defaults: T, overrides?: Partial<T> | null): T {
  if (!overrides) return { ...defaults };

  const result = { ...defaults };
  for (const key of Object.keys(overrides) as (keyof T)[]) {
    const value = overrides[key];
    if (value !== undefined) {
      result[key] = value as T[keyof T];
    }
  }
  return result;
}
