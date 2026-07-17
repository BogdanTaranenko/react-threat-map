/**
 * A synthetic attack feed for the demo.
 *
 * Deliberately shaped like a real one: heavy concentration in a few origin
 * regions (so aggregation has something to do), a long tail elsewhere, and a
 * mix of location formats.
 */

import type { Attack, RegionCode, Severity } from 'react-threat-map';

/** Origins weighted by how much traffic they emit, roughly mirroring a real feed. */
const ORIGINS: Array<{ region: string; weight: number }> = [
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

const TARGETS = ['US-CA', 'US-NY', 'US-TX', 'US-VA', 'GB', 'DE', 'JP', 'FR', 'AU', 'SG', 'CA'];

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
      type: TYPES[index % TYPES.length] as string,
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
