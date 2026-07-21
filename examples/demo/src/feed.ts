/**
 * A synthetic attack feed for the demo.
 *
 * Deliberately shaped like a real one: heavy concentration in a few origin
 * regions (so aggregation has something to do), a long tail elsewhere, and a
 * mix of location formats.
 */

import type { Attack, AttackLocation, RegionCode, Severity } from 'react-threat-map';

/** Origins weighted by how much traffic they emit, roughly mirroring a real feed. */
const ORIGINS: Array<{ region: RegionCode; weight: number }> = [
  { region: 'CN', weight: 22 },
  { region: 'RU', weight: 18 },
  { region: 'US-CA', weight: 14 },
  { region: 'US-TX', weight: 8 },
  { region: 'US-NY', weight: 6 },
  { region: 'BR', weight: 7 },
  { region: 'IN', weight: 7 },
  { region: 'IR', weight: 5 },
  { region: 'KP', weight: 4 },
  { region: 'NL', weight: 4 },
  { region: 'VN', weight: 4 },
  { region: 'UA', weight: 3 },
  { region: 'RO', weight: 3 },
  { region: 'NG', weight: 2 },
  { region: 'ID', weight: 2 },
];

const TARGETS: readonly RegionCode[] = ['US-CA', 'US-NY', 'US-TX', 'US-VA', 'GB', 'DE', 'JP', 'FR', 'AU', 'SG', 'CA'];

const TYPES = ['ssh-bruteforce', 'ddos', 'phishing', 'sql-injection', 'port-scan', 'malware-c2', 'credential-stuffing'];

const SEVERITIES: Array<{ value: Severity; weight: number }> = [
  { value: 'low', weight: 45 },
  { value: 'medium', weight: 30 },
  { value: 'high', weight: 18 },
  { value: 'critical', weight: 7 },
];

function pickWeighted<T>(items: Array<{ weight: number } & T>): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1] as T;
}

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T;

let sequence = 0;

/** One synthetic attack. */
export function makeAttack(): Attack {
  const origin = pickWeighted(ORIGINS);
  return {
    id: `evt-${sequence++}`,
    from: origin.region,
    to: pick(TARGETS),
    timestamp: Date.now(),
    type: pick(TYPES),
    severity: pickWeighted(SEVERITIES).value,
  };
}

/** A batch of synthetic attacks. */
export function makeAttacks(count: number): Attack[] {
  return Array.from({ length: count }, makeAttack);
}

/* ------------------------------- campaigns -------------------------------- */

/** One origin's contribution to a campaign against a single target. */
export interface CampaignOrigin {
  /** Where the traffic comes from. */
  readonly region: RegionCode;
  /** Display name, for the demo's legend. */
  readonly name: string;
  /** How many attacks this origin sends. */
  readonly count: number;
  /** Severity every attack from this origin carries. */
  readonly severity: Severity;
}

/**
 * Five origins hammering one target, at deliberately uneven volumes.
 *
 * The counts span an order of magnitude on purpose: aggregation collapses each
 * origin to a single line whose weight comes from its count, so the spread is
 * what makes the intensity ramp legible rather than five identical lines.
 */
export const GHANA_CAMPAIGN: readonly CampaignOrigin[] = [
  { region: 'RU', name: 'Russia', count: 48, severity: 'critical' },
  { region: 'CN', name: 'China', count: 31, severity: 'high' },
  { region: 'BR', name: 'Brazil', count: 17, severity: 'medium' },
  { region: 'IR', name: 'Iran', count: 9, severity: 'high' },
  { region: 'VN', name: 'Vietnam', count: 4, severity: 'low' },
];

/**
 * Expand a campaign into the individual attacks behind it.
 *
 * Fully deterministic, unlike the random feeds above: the demo's legend states
 * each origin's count, so the map has to be checkable against it.
 */
export function makeCampaignAttacks(origins: readonly CampaignOrigin[], target: RegionCode): Attack[] {
  return origins.flatMap(({ region, count, severity }) =>
    Array.from({ length: count }, (_, index) => ({
      id: `campaign-${region}-${index}`,
      from: region,
      to: target,
      type: TYPES[index % TYPES.length],
      severity,
    })),
  );
}

/* -------------------------------- domestic --------------------------------- */

/** One flow inside a single country. */
export interface DomesticFlow {
  /** Stable key, since a location may be an object rather than a code. */
  readonly id: string;
  /** Which country view this flow belongs to. */
  readonly scope: 'us' | 'de';
  /** Origin. A region code, or coordinates for city-level precision. */
  readonly from: AttackLocation;
  /** Destination. */
  readonly to: AttackLocation;
  /** Display label, for the demo's legend. */
  readonly label: string;
  /** How many attacks travel this flow. */
  readonly count: number;
  /** Severity every attack on this flow carries. */
  readonly severity: Severity;
}

/** Frankfurt, to the nearest street. Germany has no subdivisions in this library. */
const FRANKFURT = { lat: 50.11, lng: 8.68, region: 'DE' } as const;

/**
 * Three attacks that start and end in the same city.
 *
 * The awkward case, and the reason it is here. Germany has no subdivision data,
 * so `'DE' → 'DE'` would resolve both ends to one country anchor; giving explicit
 * coordinates pins them to Frankfurt instead, but both ends are still *the same
 * coordinate*. Either way the chord is zero, which is what `buildArc` now answers
 * with a self-loop rather than an invisible point.
 *
 * Coordinates carry an explicit `region`, which is the cheap path: it skips the
 * point-in-polygon walk and does not need boundary geometry to have loaded.
 */
export const DE_LOCAL: DomesticFlow = {
  id: 'de-frankfurt-local',
  scope: 'de',
  from: FRANKFURT,
  to: FRANKFURT,
  label: 'Frankfurt → Frankfurt',
  count: 3,
  severity: 'critical',
};

/**
 * Lateral movement inside one country: every origin and every destination is a
 * US state, so no arc ever leaves American soil.
 *
 * The last entry is deliberately a *self-flow* — California to California. Both
 * endpoints resolve to the same state anchor, so there is no chord and no
 * direction of travel; `buildArc` renders it as a self-loop. It is the same case
 * as {@link DE_LOCAL}, reached from the opposite direction: California has its
 * own anchor and still collapses, because origin and destination are one region.
 */
export const US_LATERAL: readonly DomesticFlow[] = [
  { id: 'us-ca-ny', scope: 'us', from: 'US-CA', to: 'US-NY', label: 'California → New York', count: 34, severity: 'critical' },
  { id: 'us-tx-va', scope: 'us', from: 'US-TX', to: 'US-VA', label: 'Texas → Virginia', count: 21, severity: 'high' },
  { id: 'us-wa-fl', scope: 'us', from: 'US-WA', to: 'US-FL', label: 'Washington → Florida', count: 13, severity: 'medium' },
  { id: 'us-il-ga', scope: 'us', from: 'US-IL', to: 'US-GA', label: 'Illinois → Georgia', count: 8, severity: 'medium' },
  { id: 'us-ny-va', scope: 'us', from: 'US-NY', to: 'US-VA', label: 'New York → Virginia', count: 5, severity: 'low' },
  { id: 'us-ca-ca', scope: 'us', from: 'US-CA', to: 'US-CA', label: 'California → California', count: 11, severity: 'high' },
];

/** Every domestic flow the demo renders, in legend order. */
export const DOMESTIC_FLOWS: readonly DomesticFlow[] = [DE_LOCAL, ...US_LATERAL];

/**
 * Expand domestic flows into the individual attacks behind them.
 *
 * Deterministic, like {@link makeCampaignAttacks}: the demo prints each flow's
 * count in a legend, so the map has to be checkable against it.
 */
export function makeDomesticAttacks(flows: readonly DomesticFlow[]): Attack[] {
  return flows.flatMap(({ id, from, to, count, severity }) =>
    Array.from({ length: count }, (_, index) => ({
      id: `domestic-${id}-${index}`,
      from,
      to,
      type: TYPES[index % TYPES.length],
      severity,
    })),
  );
}

/**
 * Attacks with raw coordinates instead of region codes, scattered inside their
 * origin region.
 *
 * This is the path that exercises reverse geocoding: the library has to run
 * point-in-polygon to discover that a point near Los Angeles belongs to
 * California, and then aggregate on that.
 */
export function makeCoordinateAttacks(count: number): Attack[] {
  const cities = [
    { lat: 34.05, lng: -118.24 }, // Los Angeles
    { lat: 37.77, lng: -122.42 }, // San Francisco
    { lat: 32.72, lng: -117.16 }, // San Diego
    { lat: 29.76, lng: -95.37 }, // Houston
    { lat: 32.78, lng: -96.8 }, // Dallas
    { lat: 40.71, lng: -74.01 }, // New York
    { lat: 39.9, lng: 116.4 }, // Beijing
    { lat: 31.23, lng: 121.47 }, // Shanghai
    { lat: 55.75, lng: 37.62 }, // Moscow
    { lat: 48.86, lng: 2.35 }, // Paris
    { lat: 45.76, lng: 4.84 }, // Lyon
    { lat: -23.55, lng: -46.63 }, // São Paulo
  ];

  return Array.from({ length: count }, () => {
    const city = pick(cities);
    return {
      id: `geo-${sequence++}`,
      // Jitter within ~50 km, so points scatter but stay in their region.
      from: { lat: city.lat + (Math.random() - 0.5) * 0.8, lng: city.lng + (Math.random() - 0.5) * 0.8 },
      to: pick(TARGETS),
      timestamp: Date.now(),
      type: pick(TYPES),
      severity: pickWeighted(SEVERITIES).value,
    };
  });
}
