import { describe, expect, it, vi } from 'vitest';

import { aggregateAttacks, defaultAggregation } from '../../src/aggregation/aggregate.js';
import type { Attack, ResolvedRegion, Severity } from '../../src/types.js';

/** Two attacks from California and one from Texas, all aimed at France. */
const CA_TX_TO_FR: Attack[] = [
  { id: 'a', from: 'US-CA', to: 'FR' },
  { id: 'b', from: 'US-CA', to: 'FR' },
  { id: 'c', from: 'US-TX', to: 'FR' },
];

const byId = <T extends { id: string }>(threats: readonly T[]) =>
  Object.fromEntries(threats.map((t) => [t.id, t]));

describe('aggregateAttacks', () => {
  describe('the core requirement: grouping by origin region', () => {
    it('merges attacks that share an origin region and separates those that do not', () => {
      const threats = aggregateAttacks(CA_TX_TO_FR, { config: { minCount: 1 } });

      expect(threats).toHaveLength(2);
      const map = byId(threats);
      expect(map['US-CA>FR']?.count).toBe(2);
      expect(map['US-TX>FR']?.count).toBe(1);
    });

    it('treats US states as distinct origins rather than collapsing them into US', () => {
      const threats = aggregateAttacks(CA_TX_TO_FR, { config: { minCount: 1 } });

      const origins = threats.map((t) => t.fromRegion.id).sort();
      expect(origins).toEqual(['US-CA', 'US-TX']);
    });

    it('groups on the origin region, not on raw coordinates', () => {
      // Two very different points, both inside California, tagged as such.
      const attacks: Attack[] = [
        { id: 'la', from: { lat: 34.05, lng: -118.24, region: 'US-CA' }, to: 'FR' },
        { id: 'sf', from: { lat: 37.77, lng: -122.42, region: 'US-CA' }, to: 'FR' },
      ];

      const threats = aggregateAttacks(attacks);

      expect(threats).toHaveLength(1);
      expect(threats[0]?.count).toBe(2);
      expect(threats[0]?.fromRegion.id).toBe('US-CA');
    });

    it('merges many scattered points within a country into one threat', () => {
      // The README's example: attacks from various points in France -> one threat.
      const attacks: Attack[] = [
        { id: '1', from: { lat: 48.85, lng: 2.35, region: 'FR' }, to: 'US-NY' },
        { id: '2', from: { lat: 43.3, lng: 5.37, region: 'FR' }, to: 'US-NY' },
        { id: '3', from: { lat: 45.76, lng: 4.84, region: 'FR' }, to: 'US-NY' },
      ];

      const threats = aggregateAttacks(attacks);

      expect(threats).toHaveLength(1);
      expect(threats[0]).toMatchObject({ id: 'FR>US-NY', count: 3, fromRegion: { name: 'France' } });
    });
  });

  describe('granularity', () => {
    it("'country' collapses US states together", () => {
      const threats = aggregateAttacks(CA_TX_TO_FR, { config: { granularity: 'country', minCount: 1 } });

      expect(threats).toHaveLength(1);
      expect(threats[0]?.id).toBe('US>FR');
      expect(threats[0]?.count).toBe(3);
    });

    it("'auto' keeps US at state level while leaving other countries whole", () => {
      const attacks: Attack[] = [
        ...CA_TX_TO_FR,
        { id: 'd', from: 'FR', to: 'US-CA' },
        { id: 'e', from: 'FR', to: 'US-CA' },
      ];

      const threats = aggregateAttacks(attacks, { config: { granularity: 'auto', minCount: 1 } });
      const map = byId(threats);

      expect(map['US-CA>FR']?.count).toBe(2);
      expect(map['US-TX>FR']?.count).toBe(1);
      expect(map['FR>US-CA']?.count).toBe(2);
    });

    it("'auto' resolves destinations at state granularity too", () => {
      const threats = aggregateAttacks([{ from: 'FR', to: 'US-NY' }], { config: { minCount: 1 } });
      expect(threats[0]?.id).toBe('FR>US-NY');
    });
  });

  describe('groupBy', () => {
    it("'origin-destination' (default) keeps different destinations on separate lines", () => {
      const attacks: Attack[] = [
        { id: '1', from: 'FR', to: 'US-CA' },
        { id: '2', from: 'FR', to: 'JP' },
      ];

      const threats = aggregateAttacks(attacks, { config: { minCount: 1 } });

      expect(threats).toHaveLength(2);
      expect(threats.map((t) => t.id).sort()).toEqual(['FR>JP', 'FR>US-CA']);
    });

    it("'origin' collapses every destination into one line per origin", () => {
      const attacks: Attack[] = [
        { id: '1', from: 'FR', to: 'US-CA' },
        { id: '2', from: 'FR', to: 'JP' },
      ];

      const threats = aggregateAttacks(attacks, { config: { groupBy: 'origin', minCount: 1 } });

      expect(threats).toHaveLength(1);
      expect(threats[0]?.id).toBe('FR');
      expect(threats[0]?.count).toBe(2);
    });

    it("'origin' points the merged line at the destination carrying the most weight", () => {
      const attacks: Attack[] = [
        { id: '1', from: 'FR', to: 'US-CA', weight: 1 },
        { id: '2', from: 'FR', to: 'JP', weight: 50 },
        { id: '3', from: 'FR', to: 'US-CA', weight: 2 },
      ];

      const threats = aggregateAttacks(attacks, { config: { groupBy: 'origin', minCount: 1 } });

      expect(threats[0]?.toRegion.id).toBe('JP');
    });

    it("'origin' breaks destination ties deterministically", () => {
      const attacks: Attack[] = [
        { id: '1', from: 'FR', to: 'JP', weight: 5 },
        { id: '2', from: 'FR', to: 'BR', weight: 5 },
      ];

      const run = () => aggregateAttacks(attacks, { config: { groupBy: 'origin', minCount: 1 } })[0]?.toRegion.id;
      expect(run()).toBe('BR'); // lowest id wins the tie
      expect(run()).toBe(run());
    });
  });

  describe('visual weight scales with count', () => {
    it('gives a bigger group a higher intensity', () => {
      const two = aggregateAttacks(
        [
          { id: '1', from: 'FR', to: 'US-CA' },
          { id: '2', from: 'FR', to: 'US-CA' },
        ],
        { config: { minCount: 1 } },
      );
      const many = aggregateAttacks(
        Array.from({ length: 64 }, (_, i) => ({ id: `x${i}`, from: 'FR', to: 'US-CA' })),
        { config: { minCount: 1 } },
      );

      expect(two[0]?.intensity).toBeGreaterThan(1);
      expect(many[0]?.intensity).toBeGreaterThan(two[0]!.intensity);
    });

    it('leaves a single attack at baseline intensity', () => {
      const threats = aggregateAttacks([{ from: 'FR', to: 'US-CA' }]);
      expect(threats[0]?.intensity).toBe(1);
      expect(threats[0]?.count).toBe(1);
    });

    it('clamps intensity so one enormous group cannot swamp the map', () => {
      const attacks = Array.from({ length: 5000 }, (_, i) => ({ id: `x${i}`, from: 'FR', to: 'US-CA' }));
      const threats = aggregateAttacks(attacks);
      expect(threats[0]?.intensity).toBeLessThanOrEqual(6);
    });

    it('honours a custom scale', () => {
      const threats = aggregateAttacks(CA_TX_TO_FR, {
        config: { minCount: 1, scale: (count) => count * 2 },
      });
      expect(byId(threats)['US-CA>FR']?.intensity).toBe(4);
    });

    it('clamps a custom scale that returns nonsense rather than passing NaN to canvas', () => {
      const cases: Array<[number, number]> = [
        [NaN, 1],
        [Infinity, 6],
        [-5, 0],
        [1e9, 6],
      ];

      for (const [returned, expected] of cases) {
        const threats = aggregateAttacks(CA_TX_TO_FR, { config: { minCount: 1, scale: () => returned } });
        expect(byId(threats)['US-CA>FR']?.intensity, `scale returning ${returned}`).toBe(expected);
      }
    });

    it('sums weights rather than counting rows', () => {
      const attacks: Attack[] = [
        { id: '1', from: 'FR', to: 'US-CA', weight: 100 },
        { id: '2', from: 'FR', to: 'US-CA', weight: 250 },
      ];

      const threats = aggregateAttacks(attacks);

      expect(threats[0]?.totalWeight).toBe(350);
      expect(threats[0]?.count).toBe(2);
    });

    it('defaults a missing, zero, negative, or non-finite weight to 1', () => {
      const attacks: Attack[] = [
        { id: '1', from: 'FR', to: 'US-CA' },
        { id: '2', from: 'FR', to: 'US-CA', weight: -3 },
        { id: '3', from: 'FR', to: 'US-CA', weight: NaN },
        { id: '4', from: 'FR', to: 'US-CA', weight: 0 },
      ];

      const threats = aggregateAttacks(attacks);
      expect(threats[0]?.totalWeight).toBe(4);
    });
  });

  describe('severity', () => {
    it('takes the max severity in the group, not the mode', () => {
      const attacks: Attack[] = [
        ...Array.from({ length: 40 }, (_, i) => ({ id: `l${i}`, from: 'FR', to: 'US-CA', severity: 'low' as const })),
        { id: 'crit', from: 'FR', to: 'US-CA', severity: 'critical' },
      ];

      const threats = aggregateAttacks(attacks);
      expect(threats[0]?.severity).toBe('critical');
    });

    it('ranks an unknown custom severity as medium instead of letting it outrank critical', () => {
      const attacks: Attack[] = [
        { id: '1', from: 'FR', to: 'US-CA', severity: 'spicy' },
        { id: '2', from: 'FR', to: 'US-CA', severity: 'high' },
      ];

      expect(aggregateAttacks(attacks)[0]?.severity).toBe('high');
    });

    it('defaults a missing severity to medium', () => {
      expect(aggregateAttacks([{ from: 'FR', to: 'US-CA' }])[0]?.severity).toBe('medium');
    });

    it('honours a custom severity reducer', () => {
      const severity = vi.fn((list: readonly Severity[]) => list[0] as Severity);
      const attacks: Attack[] = [
        { id: '1', from: 'FR', to: 'US-CA', severity: 'low' },
        { id: '2', from: 'FR', to: 'US-CA', severity: 'critical' },
      ];

      expect(aggregateAttacks(attacks, { config: { severity } })[0]?.severity).toBe('low');
      expect(severity).toHaveBeenCalledWith(['low', 'critical']);
    });
  });

  describe('minCount', () => {
    it('renders groups below the threshold as individual threats', () => {
      // minCount 3: the 2 California attacks stay separate, Texas' 1 stays separate.
      const threats = aggregateAttacks(CA_TX_TO_FR, { config: { minCount: 3 } });

      expect(threats).toHaveLength(3);
      expect(threats.every((t) => t.count === 1)).toBe(true);
      expect(threats.map((t) => t.id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('merges once the threshold is met', () => {
      const threats = aggregateAttacks(CA_TX_TO_FR, { config: { minCount: 2 } });

      expect(threats).toHaveLength(2);
      expect(byId(threats)['US-CA>FR']?.count).toBe(2);
      expect(byId(threats)['c']?.count).toBe(1); // Texas fell back to its attack id
    });

    it('defaults to 2, so a lone attack is never dressed up as a group', () => {
      expect(defaultAggregation.minCount).toBe(2);
      const threats = aggregateAttacks([{ id: 'solo', from: 'FR', to: 'US-CA' }]);
      expect(threats[0]?.id).toBe('solo');
      expect(threats[0]?.count).toBe(1);
    });
  });

  describe('maxGroups', () => {
    it('keeps the heaviest groups and drops the rest', () => {
      const attacks: Attack[] = [
        { id: '1', from: 'FR', to: 'US-CA', weight: 1 },
        { id: '2', from: 'JP', to: 'US-CA', weight: 500 },
        { id: '3', from: 'BR', to: 'US-CA', weight: 50 },
      ];

      const threats = aggregateAttacks(attacks, { config: { minCount: 1, maxGroups: 2 } });

      expect(threats).toHaveLength(2);
      expect(threats.map((t) => t.fromRegion.id)).toEqual(['JP', 'BR']);
    });

    it('is unlimited when unset', () => {
      const attacks = Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, from: 'FR', to: 'US-CA' }));
      expect(aggregateAttacks(attacks, { config: { minCount: 1, groupBy: 'origin' } })).toHaveLength(1);
    });

    it('renders nothing at maxGroups: 0', () => {
      expect(aggregateAttacks(CA_TX_TO_FR, { config: { maxGroups: 0 } })).toHaveLength(0);
    });
  });

  describe('disabling', () => {
    it('emits one threat per attack when passed false', () => {
      const threats = aggregateAttacks(CA_TX_TO_FR, { config: false });

      expect(threats).toHaveLength(3);
      expect(threats.every((t) => t.count === 1 && t.intensity === 1)).toBe(true);
      expect(threats.map((t) => t.id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('treats { enabled: false } the same as false', () => {
      const off = aggregateAttacks(CA_TX_TO_FR, { config: { enabled: false } });
      expect(off).toHaveLength(3);
      expect(off.map((t) => t.id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('does not disable aggregation when enabled is explicitly undefined', () => {
      // Regression: a plain spread would turn `{enabled: undefined}` into
      // `enabled: undefined` and disable aggregation. This is reachable from
      // `aggregation={{ enabled: someUnsetProp }}`.
      const threats = aggregateAttacks(CA_TX_TO_FR, { config: { enabled: undefined } });
      expect(threats).toHaveLength(2);
    });
  });

  describe('custom key function', () => {
    it('overrides grouping entirely', () => {
      const attacks: Attack[] = [
        { id: '1', from: 'FR', to: 'US-CA', type: 'ddos' },
        { id: '2', from: 'FR', to: 'US-CA', type: 'phishing' },
        { id: '3', from: 'FR', to: 'JP', type: 'ddos' },
      ];

      // Group by origin + type, ignoring destination.
      const threats = aggregateAttacks(attacks, {
        config: { minCount: 1, key: (attack, from) => `${from.id}:${attack.type}` },
      });

      expect(threats.map((t) => t.id).sort()).toEqual(['FR:ddos', 'FR:phishing']);
      expect(byId(threats)['FR:ddos']?.count).toBe(2);
    });

    it('receives both resolved regions', () => {
      const key = vi.fn(() => 'k');
      aggregateAttacks([{ id: '1', from: 'US-CA', to: 'FR' }], { config: { minCount: 1, key } });

      const [attack, from, to] = key.mock.calls[0] as unknown as [Attack, ResolvedRegion, ResolvedRegion];
      expect(attack.id).toBe('1');
      expect(from).toMatchObject({ id: 'US-CA', name: 'California', kind: 'state', countryCode: 'US' });
      expect(to).toMatchObject({ id: 'FR', kind: 'country' });
    });

    it('renders an attack individually when the key returns null', () => {
      const threats = aggregateAttacks(CA_TX_TO_FR, {
        config: { minCount: 1, key: (attack) => (attack.id === 'c' ? null : 'shared') },
      });

      expect(threats).toHaveLength(2);
      expect(byId(threats)['shared']?.count).toBe(2);
      expect(byId(threats)['c']?.count).toBe(1);
    });

    it('takes precedence over granularity and groupBy', () => {
      const threats = aggregateAttacks(CA_TX_TO_FR, {
        config: { minCount: 1, granularity: 'country', groupBy: 'origin', key: () => 'everything' },
      });

      expect(threats).toHaveLength(1);
      expect(threats[0]?.id).toBe('everything');
      expect(threats[0]?.count).toBe(3);
    });
  });

  describe('error handling', () => {
    it('reports and skips an unresolvable origin without dropping valid attacks', () => {
      const onError = vi.fn();
      const attacks: Attack[] = [
        { id: 'bad', from: 'NOT_A_REGION', to: 'FR' },
        { id: 'good', from: 'US-CA', to: 'FR' },
      ];

      const threats = aggregateAttacks(attacks, { onError });

      expect(threats).toHaveLength(1);
      expect(threats[0]?.id).toBe('good');
      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0]?.[0]).toMatch(/Could not resolve attack origin/);
    });

    it('reports an unresolvable destination', () => {
      const onError = vi.fn();
      aggregateAttacks([{ id: 'x', from: 'FR', to: 'ZZZZ' }], { onError });

      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0]?.[0]).toMatch(/Could not resolve attack destination/);
    });

    it('reports out-of-range coordinates', () => {
      const onError = vi.fn();
      const threats = aggregateAttacks([{ id: 'x', from: { lat: 91, lng: 0 }, to: 'FR' }], { onError });

      expect(threats).toHaveLength(0);
      expect(onError.mock.calls[0]?.[0]).toMatch(/Latitude must be within/);
    });

    it('does not throw without an onError handler', () => {
      expect(() => aggregateAttacks([{ from: 'NOPE', to: 'FR' }])).not.toThrow();
    });

    it('returns an empty array for an empty input', () => {
      expect(aggregateAttacks([])).toEqual([]);
    });
  });

  describe('determinism and identity', () => {
    it('produces a stable id for the same group across calls', () => {
      const first = aggregateAttacks(CA_TX_TO_FR);
      const second = aggregateAttacks([...CA_TX_TO_FR].reverse());

      expect(first.map((t) => t.id).sort()).toEqual(second.map((t) => t.id).sort());
    });

    it('orders output by descending weight so maxGroups keeps what matters', () => {
      const attacks: Attack[] = [
        { id: 'light', from: 'FR', to: 'US-CA', weight: 1 },
        { id: 'heavy', from: 'JP', to: 'US-CA', weight: 900 },
      ];

      const weights = aggregateAttacks(attacks, { config: { minCount: 1 } }).map((t) => t.totalWeight);
      expect(weights).toEqual([900, 1]);
    });

    it('breaks weight ties by id rather than leaking input order', () => {
      const attacks: Attack[] = [
        { id: 'z', from: 'JP', to: 'FR' },
        { id: 'a', from: 'BR', to: 'FR' },
      ];

      expect(aggregateAttacks(attacks).map((t) => t.id)).toEqual(['a', 'z']);
      expect(aggregateAttacks([...attacks].reverse()).map((t) => t.id)).toEqual(['a', 'z']);
    });

    it('derives a content-based id for attacks with no id', () => {
      const threats = aggregateAttacks([{ from: 'FR', to: 'JP', timestamp: 1234 }], { config: false });
      expect(threats[0]?.id).toBe('FR>JP@1234');
    });

    it('keeps every underlying attack reachable on the aggregate', () => {
      const threats = aggregateAttacks(CA_TX_TO_FR, { config: { minCount: 1 } });
      const california = byId(threats)['US-CA>FR'];

      expect(california?.attacks).toHaveLength(2);
      expect(california?.attacks.map((a) => a.id)).toEqual(['a', 'b']);
    });

    it('passes consumer meta through untouched', () => {
      interface Meta { targetPort: number }
      const attacks: Attack<Meta>[] = [{ id: '1', from: 'FR', to: 'JP', meta: { targetPort: 22 } }];

      const threats = aggregateAttacks(attacks, { config: false });
      expect(threats[0]?.attacks[0]?.meta?.targetPort).toBe(22);
    });

    it('does not mutate the input array or its attacks', () => {
      const input: Attack[] = [{ id: 'a', from: 'US-CA', to: 'FR' }];
      const snapshot = structuredClone(input);

      aggregateAttacks(input);

      expect(input).toEqual(snapshot);
    });
  });

  describe('geometry of the collapsed origin', () => {
    it('averages member coordinates so the tail sits among the real origins', () => {
      const attacks: Attack[] = [
        { id: '1', from: { lat: 10, lng: 20, region: 'FR' }, to: 'JP' },
        { id: '2', from: { lat: 20, lng: 40, region: 'FR' }, to: 'JP' },
      ];

      const threat = aggregateAttacks(attacks)[0];
      expect(threat?.from.lat).toBeCloseTo(15, 5);
      expect(threat?.from.lng).toBeCloseTo(30, 5);
    });

    it('averages longitude across the antimeridian without landing in Africa', () => {
      // -179 and +179 are 2 degrees apart; the arithmetic mean would be 0.
      const attacks: Attack[] = [
        { id: '1', from: { lat: 0, lng: -179, region: 'FR' }, to: 'JP' },
        { id: '2', from: { lat: 0, lng: 179, region: 'FR' }, to: 'JP' },
      ];

      const threat = aggregateAttacks(attacks)[0];
      expect(Math.abs(threat!.from.lng)).toBeCloseTo(180, 4);
    });

    it('falls back to a member longitude when antipodal points cancel out', () => {
      const attacks: Attack[] = [
        { id: '1', from: { lat: 0, lng: 0, region: 'FR' }, to: 'JP' },
        { id: '2', from: { lat: 0, lng: 180, region: 'FR' }, to: 'JP' },
      ];

      const threat = aggregateAttacks(attacks)[0];
      expect(Number.isFinite(threat!.from.lng)).toBe(true);
    });
  });
});
