/**
 * The aggregation stage: many {@link Attack}s in, few {@link Threat}s out.
 *
 * A pure function. No React, no canvas, no async, no geometry — which is what
 * makes it exhaustively unit-testable and reusable outside the component (for a
 * table view, a CSV export, a test assertion).
 *
 * @packageDocumentation
 */

import type {
  AggregationConfig,
  Attack,
  LatLng,
  ResolvedRegion,
  Severity,
  Threat,
} from '../types.js';
import type { RegionIndex } from '../geo/lookup.js';
import { resolveLocation } from '../geo/resolve.js';
import { mergeDefined } from '../utils/merge.js';
import { maxSeverity, regionKey } from './keys.js';
import { clampIntensity, defaultIntensityScale } from './scale.js';

/**
 * An {@link AggregationConfig} with every default filled in.
 *
 * `key` and `maxGroups` stay optional because "absent" is a meaningful state for
 * both — there is no sentinel value that means "no custom key function" or
 * "no cap" as naturally as their absence does.
 */
export type ResolvedAggregationConfig<TMeta = unknown> = Required<
  Omit<AggregationConfig<TMeta>, 'key' | 'maxGroups'>
> & {
  readonly key?: AggregationConfig<TMeta>['key'];
  readonly maxGroups?: number;
};

/**
 * Defaults for {@link AggregationConfig}.
 *
 * Exported so you can read or extend them:
 *
 * ```ts
 * import { defaultAggregation } from 'react-threat-map';
 * const scale = defaultAggregation.scale; // the built-in log ramp
 * ```
 */
export const defaultAggregation: ResolvedAggregationConfig = Object.freeze({
  enabled: true,
  granularity: 'auto',
  groupBy: 'origin-destination',
  minCount: 2,
  scale: defaultIntensityScale,
  severity: maxSeverity,
});

/** Options for {@link aggregateAttacks} beyond the aggregation config itself. */
export interface AggregateOptions<TMeta = unknown> {
  /** Aggregation settings. Merged over {@link defaultAggregation}. Pass `false` to disable. */
  readonly config?: Partial<AggregationConfig<TMeta>> | false;
  /** Boundary index, enabling reverse resolution of bare coordinates. Optional. */
  readonly index?: RegionIndex | null;
  /** Reports attacks that could not be resolved. */
  readonly onError?: (message: string, attack: Attack<TMeta>) => void;
}

/** An attack with both endpoints resolved. @internal */
interface Prepared<TMeta> {
  readonly attack: Attack<TMeta>;
  readonly from: LatLng;
  readonly to: LatLng;
  readonly fromRegion: ResolvedRegion;
  readonly toRegion: ResolvedRegion;
  readonly weight: number;
  readonly severity: Severity;
}

/** A mutable accumulator, collapsed into a `Threat` at the end. @internal */
interface Group<TMeta> {
  readonly key: string;
  readonly members: Prepared<TMeta>[];
  totalWeight: number;
}

/**
 * Aggregate attacks into renderable threats.
 *
 * Pipeline:
 * 1. **Resolve** each attack's endpoints to coordinates + regions. Unresolvable
 *    attacks are reported via `onError` and dropped.
 * 2. **Group** by key — derived from the origin region (and destination, by
 *    default), or from a custom `key` function.
 * 3. **Split out undersized groups.** Groups below `minCount` are emitted as
 *    individual threats: merging two attacks into a "group of 2" adds visual
 *    weight without adding information.
 * 4. **Collapse** each surviving group into one threat, summing weight, taking
 *    max severity, and scaling intensity by count.
 * 5. **Cap** to `maxGroups`, keeping the heaviest.
 *
 * Output order is deterministic — descending `totalWeight`, ties broken by `id` —
 * so renders are stable across calls and snapshot tests do not flake.
 *
 * @param attacks - The attacks to aggregate.
 * @param options - See {@link AggregateOptions}.
 * @returns Threats to render, heaviest first.
 *
 * @example Aggregation on (the default)
 * ```ts
 * const threats = aggregateAttacks([
 *   { from: { lat: 34.0, lng: -118.2, region: 'US-CA' }, to: 'FR' },
 *   { from: { lat: 37.8, lng: -122.4, region: 'US-CA' }, to: 'FR' },
 *   { from: 'US-TX', to: 'FR' },
 * ]);
 * // 2 threats: California→France (count 2, heavier) and Texas→France (count 1).
 * ```
 *
 * @example Aggregation off
 * ```ts
 * const threats = aggregateAttacks(attacks, { config: false });
 * // one threat per attack, every count === 1
 * ```
 */
export function aggregateAttacks<TMeta = unknown>(
  attacks: readonly Attack<TMeta>[],
  options: AggregateOptions<TMeta> = {},
): Threat<TMeta>[] {
  const { index = null, onError } = options;
  const config = resolveConfig(options.config);

  const prepared = prepareAll(attacks, index, config.granularity, onError);

  if (!config.enabled) {
    return sortThreats(prepared.map((p, i) => toSoloThreat(p, i)));
  }

  const { groups, ungrouped } = groupAll(prepared, config);

  const threats: Threat<TMeta>[] = [];
  for (const p of ungrouped) {
    threats.push(toSoloThreat(p, threats.length));
  }
  for (const group of groups) {
    if (group.members.length < config.minCount) {
      // Too small to be worth merging — render the members individually.
      for (const p of group.members) threats.push(toSoloThreat(p, threats.length));
    } else {
      threats.push(collapse(group, config));
    }
  }

  const sorted = sortThreats(threats);
  return config.maxGroups != null && config.maxGroups >= 0
    ? sorted.slice(0, config.maxGroups)
    : sorted;
}

/* --------------------------------- config --------------------------------- */

type ResolvedConfig<TMeta> = ResolvedAggregationConfig<TMeta>;

/**
 * Fold user config over the defaults.
 *
 * `aggregation={false}` and `aggregation={{enabled: false}}` are equivalent; the
 * former is the ergonomic spelling. Merging ignores `undefined` values so that
 * `{enabled: someUndefinedVar}` does not silently disable aggregation — see
 * {@link mergeDefined}.
 */
function resolveConfig<TMeta>(config: Partial<AggregationConfig<TMeta>> | false | undefined): ResolvedConfig<TMeta> {
  const base = defaultAggregation as ResolvedConfig<TMeta>;
  if (config === false) {
    return { ...base, enabled: false };
  }
  return mergeDefined(base as Required<ResolvedConfig<TMeta>>, config as Partial<Required<ResolvedConfig<TMeta>>>);
}

/* -------------------------------- resolving ------------------------------- */

function prepareAll<TMeta>(
  attacks: readonly Attack<TMeta>[],
  index: RegionIndex | null,
  granularity: AggregationConfig['granularity'],
  onError: AggregateOptions<TMeta>['onError'],
): Prepared<TMeta>[] {
  // Only reverse-resolve to state granularity when the grouping could use it.
  // At 'country' granularity a state answer would just be collapsed again, so
  // we skip the extra polygon tests.
  const preferStates = granularity !== 'country';
  const out: Prepared<TMeta>[] = [];

  for (const attack of attacks) {
    const from = resolveLocation(attack.from, index, preferStates);
    if (!from.ok) {
      onError?.(`Could not resolve attack origin: ${from.reason}`, attack);
      continue;
    }
    const to = resolveLocation(attack.to, index, preferStates);
    if (!to.ok) {
      onError?.(`Could not resolve attack destination: ${to.reason}`, attack);
      continue;
    }

    const rawWeight = attack.weight ?? 1;
    out.push({
      attack,
      from: from.value.point,
      to: to.value.point,
      fromRegion: from.value.region,
      toRegion: to.value.region,
      // A non-finite or negative weight would poison totalWeight and, through
      // it, the intensity scale and the maxGroups ordering.
      weight: Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 1,
      severity: attack.severity ?? 'medium',
    });
  }

  return out;
}

/* -------------------------------- grouping -------------------------------- */

function groupAll<TMeta>(
  prepared: readonly Prepared<TMeta>[],
  config: ResolvedConfig<TMeta>,
): { groups: Group<TMeta>[]; ungrouped: Prepared<TMeta>[] } {
  const groups = new Map<string, Group<TMeta>>();
  const ungrouped: Prepared<TMeta>[] = [];

  for (const p of prepared) {
    const key = deriveKey(p, config);
    if (key === null) {
      // A custom key fn opted this attack out of grouping.
      ungrouped.push(p);
      continue;
    }

    let group = groups.get(key);
    if (!group) {
      group = { key, members: [], totalWeight: 0 };
      groups.set(key, group);
    }
    group.members.push(p);
    group.totalWeight += p.weight;
  }

  return { groups: [...groups.values()], ungrouped };
}

function deriveKey<TMeta>(p: Prepared<TMeta>, config: ResolvedConfig<TMeta>): string | null {
  if (config.key) {
    return config.key(p.attack, p.fromRegion, p.toRegion);
  }

  const origin = regionKey(p.fromRegion, config.granularity);
  if (config.groupBy === 'origin') return origin;

  // Destination granularity intentionally mirrors the origin's, so that
  // 'auto' produces US-CA→US-NY rather than US-CA→US.
  const destination = regionKey(p.toRegion, config.granularity);
  return `${origin}>${destination}`;
}

/* -------------------------------- collapsing ------------------------------- */

function collapse<TMeta>(group: Group<TMeta>, config: ResolvedConfig<TMeta>): Threat<TMeta> {
  const members = group.members;
  const first = members[0] as Prepared<TMeta>;

  // Under groupBy: 'origin', members disagree about the destination. Pick the
  // one the most attack weight actually points at, so the single drawn line is
  // the region's dominant target rather than an arbitrary first-seen one.
  const representative = config.groupBy === 'origin' ? dominantDestination(members) : first;

  const count = members.length;
  const severity = config.severity(members.map((m) => m.severity));
  const intensity = clampIntensity(config.scale(count, group.totalWeight));

  return {
    id: group.key,
    // Origin is the shared property of the group, so any member's coordinate
    // would do — but averaging them puts the line's tail at the centre of where
    // the attacks actually came from, which reads better than snapping to one
    // arbitrary member or to the region's anchor.
    from: meanPoint(members.map((m) => m.from)),
    to: representative.to,
    fromRegion: first.fromRegion,
    toRegion: representative.toRegion,
    count,
    totalWeight: group.totalWeight,
    severity,
    intensity,
    attacks: members.map((m) => m.attack),
  };
}

function dominantDestination<TMeta>(members: readonly Prepared<TMeta>[]): Prepared<TMeta> {
  const weightByRegion = new Map<string, number>();
  for (const m of members) {
    weightByRegion.set(m.toRegion.id, (weightByRegion.get(m.toRegion.id) ?? 0) + m.weight);
  }

  let bestId = '';
  let bestWeight = -1;
  for (const [id, weight] of weightByRegion) {
    // Ties break on region id so the choice is deterministic across runs rather
    // than dependent on Map insertion order.
    if (weight > bestWeight || (weight === bestWeight && id < bestId)) {
      bestWeight = weight;
      bestId = id;
    }
  }

  return members.find((m) => m.toRegion.id === bestId) as Prepared<TMeta>;
}

/**
 * Average a set of coordinates.
 *
 * Longitude is averaged as a unit vector rather than arithmetically, because
 * arithmetic mean is wrong across the antimeridian: points at -179° and +179°
 * are 2° apart but average to 0°, dropping the origin in West Africa instead of
 * the Pacific. Latitude has no such wraparound and averages directly.
 */
function meanPoint(points: readonly LatLng[]): LatLng {
  if (points.length === 1) return points[0] as LatLng;

  let latSum = 0;
  let x = 0;
  let y = 0;

  for (const p of points) {
    latSum += p.lat;
    const rad = (p.lng * Math.PI) / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
  }

  const lat = latSum / points.length;
  // Antipodal points cancel to (0,0), where atan2 is meaningless. Fall back to
  // the first point rather than emitting an arbitrary longitude.
  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) {
    return { lat, lng: (points[0] as LatLng).lng };
  }

  return { lat, lng: (Math.atan2(y, x) * 180) / Math.PI };
}

function toSoloThreat<TMeta>(p: Prepared<TMeta>, ordinal: number): Threat<TMeta> {
  return {
    id: attackId(p.attack, ordinal),
    from: p.from,
    to: p.to,
    fromRegion: p.fromRegion,
    toRegion: p.toRegion,
    count: 1,
    totalWeight: p.weight,
    severity: p.severity,
    intensity: 1,
    attacks: [p.attack],
  };
}

/**
 * Identity for an ungrouped attack.
 *
 * Prefers the caller's `id`. Without one, we derive a key from the attack's
 * content so that a stable feed produces stable ids across renders — which is
 * what keeps an in-flight animation attached to its threat. The ordinal is the
 * last resort and is the reason `Attack.id` is strongly recommended for
 * streaming data.
 */
function attackId<TMeta>(attack: Attack<TMeta>, ordinal: number): string {
  if (attack.id) return attack.id;
  const from = typeof attack.from === 'string' ? attack.from : `${attack.from.lat},${attack.from.lng}`;
  const to = typeof attack.to === 'string' ? attack.to : `${attack.to.lat},${attack.to.lng}`;
  return `${from}>${to}@${attack.timestamp ?? ordinal}`;
}

/* --------------------------------- sorting -------------------------------- */

/**
 * Heaviest first, ties broken by id.
 *
 * Descending weight is what makes `maxGroups` mean "keep the most significant
 * threats" — it can then just take a prefix. The id tiebreak makes the ordering
 * *total*: without it, `sort`'s stability leaks the input array's order into the
 * output, so a feed that reorders equal-weight attacks would reshuffle the
 * rendered set for no visible reason.
 */
function sortThreats<TMeta>(threats: Threat<TMeta>[]): Threat<TMeta>[] {
  return threats.sort((a, b) => b.totalWeight - a.totalWeight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
