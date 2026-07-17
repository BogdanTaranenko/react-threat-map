/**
 * Grouping-key derivation — the rule that decides what "the same threat" means.
 *
 * @packageDocumentation
 */

import type { AggregationGranularity, ResolvedRegion, Severity } from '../types.js';

/** Severity order, low → critical. Index doubles as the numeric rank. */
export const SEVERITY_ORDER: readonly Severity[] = ['low', 'medium', 'high', 'critical'];

const SEVERITY_RANK: ReadonlyMap<Severity, number> = new Map(SEVERITY_ORDER.map((s, i) => [s, i]));

/**
 * Rank a severity for comparison.
 *
 * @param severity - A known or custom severity.
 * @returns `0`–`3` for known severities. Unknown/custom values rank as `medium`
 *   (`1`), matching how they fall back for color — a custom severity should not
 *   silently outrank `critical` or sink below `low`.
 */
export function severityRank(severity: Severity): number {
  return SEVERITY_RANK.get(severity) ?? 1;
}

/**
 * Reduce a group's severities to the one it renders as: the **maximum**.
 *
 * A bucket holding one `critical` and forty `low` renders `critical`. For a
 * security display, hiding the worst event in a group is the more dangerous
 * failure — under-reporting a real incident beats over-reporting a benign one.
 * Override via {@link AggregationConfig.severity}.
 *
 * @param severities - Member severities. Must not be empty.
 * @returns The highest-ranked severity present.
 */
export function maxSeverity(severities: readonly Severity[]): Severity {
  let best: Severity = severities[0] ?? 'medium';
  let bestRank = severityRank(best);

  for (let i = 1; i < severities.length; i++) {
    const current = severities[i] as Severity;
    const rank = severityRank(current);
    if (rank > bestRank) {
      best = current;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Reduce a resolved region to the id aggregation groups on, at a given granularity.
 *
 * This is the function that makes US states first-class origins:
 *
 * | granularity | region        | key    |
 * | ----------- | ------------- | ------ |
 * | `'auto'`    | `US-CA` state | `US-CA` |
 * | `'auto'`    | `FR` country  | `FR`   |
 * | `'country'` | `US-CA` state | `US`   |
 * | `'state'`   | `FR` country  | `FR`   |
 *
 * `'auto'` — the default — keeps California and Texas apart while leaving the
 * rest of the world at country level, which is the behavior a threat map wants:
 * US-internal detail without shattering every other country into subdivisions we
 * do not have data for.
 *
 * @param region - The resolved region.
 * @param granularity - How specific to be.
 * @returns The group key component for this region.
 */
export function regionKey(region: ResolvedRegion, granularity: AggregationGranularity): string {
  if (region.kind === 'unknown') return region.id;

  if (granularity === 'country') {
    // Collapse `US-CA` -> `US`. For a country, countryCode is already its own id.
    return region.countryCode;
  }

  // 'auto' and 'state' agree wherever we have subdivision data: use the most
  // specific id we resolved. They differ only in intent — 'state' documents that
  // you want subdivisions everywhere they exist, 'auto' that US detail is enough.
  return region.id;
}
