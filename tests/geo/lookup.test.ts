import { beforeAll, describe, expect, it } from 'vitest';

import { RegionIndex } from '../../src/geo/lookup.js';
import { loadGeoData } from '../../src/geo/index.js';
import { aggregateAttacks } from '../../src/aggregation/aggregate.js';
import type { Attack, GeoData } from '../../src/types.js';

let geo: GeoData;
let index: RegionIndex;

beforeAll(async () => {
  geo = await loadGeoData({ states: true });
  index = new RegionIndex(geo);
});

describe('loadGeoData', () => {
  it('decodes countries with canonical ISO ids and metadata', () => {
    expect(geo.countries.features.length).toBeGreaterThan(150);

    const france = geo.countries.features.find((f) => f.id === 'FR');
    expect(france).toBeDefined();
    expect(france?.properties).toMatchObject({ name: 'France', kind: 'country', countryCode: 'FR' });
    expect(['Polygon', 'MultiPolygon']).toContain(france?.geometry.type);
  });

  it('decodes US states with ISO 3166-2 ids', () => {
    const california = geo.states?.features.find((f) => f.id === 'US-CA');
    expect(california?.properties).toMatchObject({ name: 'California', kind: 'state', countryCode: 'US' });
  });

  it('omits states unless asked for, so the chunk is not fetched', async () => {
    const countriesOnly = await loadGeoData();
    expect(countriesOnly.states).toBeUndefined();
  });

  it('caches, returning the identical object for repeated calls', async () => {
    const [a, b] = await Promise.all([loadGeoData({ states: true }), loadGeoData({ states: true })]);
    expect(a).toBe(b);
  });
});

describe('RegionIndex', () => {
  describe('reverse resolution of bare coordinates', () => {
    const cases: Array<[string, { lat: number; lng: number }, string, string]> = [
      ['Los Angeles', { lat: 34.05, lng: -118.24 }, 'US-CA', 'US'],
      ['Houston', { lat: 29.76, lng: -95.37 }, 'US-TX', 'US'],
      ['Manhattan', { lat: 40.71, lng: -74.01 }, 'US-NY', 'US'],
      ['Anchorage', { lat: 61.22, lng: -149.9 }, 'US-AK', 'US'],
      ['Honolulu', { lat: 21.31, lng: -157.86 }, 'US-HI', 'US'],
    ];

    it.each(cases)('resolves %s to the right state', (_label, point, expectedState) => {
      expect(index.resolve(point, true).id).toBe(expectedState);
    });

    it.each(cases)('resolves %s to the US when states are not preferred', (_label, point, _s, expectedCountry) => {
      expect(index.resolve(point, false).id).toBe(expectedCountry);
    });

    const countryCases: Array<[string, { lat: number; lng: number }, string]> = [
      ['Paris', { lat: 48.86, lng: 2.35 }, 'FR'],
      ['Tokyo', { lat: 35.68, lng: 139.69 }, 'JP'],
      ['São Paulo', { lat: -23.55, lng: -46.63 }, 'BR'],
      ['Cairo', { lat: 30.04, lng: 31.24 }, 'EG'],
      ['Sydney', { lat: -33.87, lng: 151.21 }, 'AU'],
      ['Moscow', { lat: 55.75, lng: 37.62 }, 'RU'],
      ['Beijing', { lat: 39.9, lng: 116.4 }, 'CN'],
    ];

    it.each(countryCases)('resolves %s to the right country', (_label, point, expected) => {
      expect(index.resolve(point, true).id).toBe(expected);
    });

    describe('small countries the 1:110m drawing data omits', () => {
      // Regression: reverse lookup originally tested only the 1:110m geometry,
      // where the Johor Strait does not exist — so a Singapore coordinate
      // point-in-polygoned straight into Malaysia, and Hong Kong into China.
      // Silently attributing an attack to the wrong sovereign country is worse
      // than returning nothing, especially in a security display. Small-country
      // geometry is now loaded alongside, and tested first.
      const cases: Array<[string, { lat: number; lng: number }, string]> = [
        ['Singapore', { lat: 1.35, lng: 103.82 }, 'SG'],
        ['Hong Kong Island', { lat: 22.32, lng: 114.17 }, 'HK'],
        ['Macao', { lat: 22.2, lng: 113.54 }, 'MO'],
        ['Malta', { lat: 35.9, lng: 14.51 }, 'MT'],
        ['Bahrain', { lat: 26.07, lng: 50.55 }, 'BH'],
        ['Luxembourg', { lat: 49.61, lng: 6.13 }, 'LU'],
        ['Monaco', { lat: 43.74, lng: 7.42 }, 'MC'],
        ['Liechtenstein', { lat: 47.14, lng: 9.52 }, 'LI'],
        ['Andorra', { lat: 42.51, lng: 1.52 }, 'AD'],
        ['San Marino', { lat: 43.94, lng: 12.45 }, 'SM'],
        ['Barbados', { lat: 13.11, lng: -59.6 }, 'BB'],
        ['Maldives', { lat: 4.18, lng: 73.51 }, 'MV'],
      ];

      it.each(cases)('resolves a bare coordinate in %s', (_label, point, expected) => {
        expect(index.resolve(point, true).id).toBe(expected);
      });

      const neighbours: Array<[string, { lat: number; lng: number }, string]> = [
        ['Shenzhen', { lat: 22.68, lng: 114.03 }, 'CN'],
        ['Guangzhou', { lat: 23.13, lng: 113.26 }, 'CN'],
        ['Johor Bahru', { lat: 1.49, lng: 103.74 }, 'MY'],
        ['Kuala Lumpur', { lat: 3.14, lng: 101.69 }, 'MY'],
        ['Nice', { lat: 43.7, lng: 7.27 }, 'FR'],
        ['Zurich', { lat: 47.37, lng: 8.54 }, 'CH'],
        ['Rome', { lat: 41.9, lng: 12.5 }, 'IT'],
        ['Barcelona', { lat: 41.39, lng: 2.17 }, 'ES'],
      ];

      // The other half of the trade: a microstate's polygon must not swallow the
      // large neighbour it sits inside.
      it.each(neighbours)('does not let a microstate steal %s', (_label, point, expected) => {
        expect(index.resolve(point, true).id).toBe(expected);
      });
    });

    it('returns unknown for points in the open ocean', () => {
      expect(index.resolve({ lat: 0, lng: -140 }, true).kind).toBe('unknown');
      expect(index.resolve({ lat: -40, lng: -30 }, true).kind).toBe('unknown');
    });

    it('prefers the state over the containing country when asked', () => {
      // A point in California is inside both US-CA and US; specificity wins.
      const point = { lat: 37.77, lng: -122.42 };
      expect(index.resolve(point, true).kind).toBe('state');
      expect(index.resolve(point, false).kind).toBe('country');
    });

    it('resolves points inside a country hole correctly', () => {
      // Rome sits inside Italy; the Vatican/San Marino enclaves make Italy's
      // polygon hole handling observable. Even-odd counting must not flip Rome out.
      expect(index.resolve({ lat: 41.9, lng: 12.5 }, true).id).toBe('IT');
    });

    it('is consistent across repeated queries (cache returns the same answer)', () => {
      const point = { lat: 34.05, lng: -118.24 };
      const first = index.resolve(point, true);
      const second = index.resolve(point, true);
      expect(second).toBe(first);
    });

    it('does not confuse the two preferStates modes in its cache', () => {
      const point = { lat: 34.05, lng: -118.24 };
      expect(index.resolve(point, true).id).toBe('US-CA');
      expect(index.resolve(point, false).id).toBe('US');
      expect(index.resolve(point, true).id).toBe('US-CA');
    });

    it('reports whether state geometry is present', () => {
      expect(index.hasStates).toBe(true);
      expect(new RegionIndex({ countries: geo.countries }).hasStates).toBe(false);
    });
  });

  describe('integration with aggregation', () => {
    it('groups bare coordinates by the state they fall in', () => {
      const attacks: Attack[] = [
        { id: 'la', from: { lat: 34.05, lng: -118.24 }, to: 'FR' },
        { id: 'sf', from: { lat: 37.77, lng: -122.42 }, to: 'FR' },
        { id: 'hou', from: { lat: 29.76, lng: -95.37 }, to: 'FR' },
      ];

      const threats = aggregateAttacks(attacks, { index, config: { minCount: 1 } });
      const map = Object.fromEntries(threats.map((t) => [t.id, t]));

      // LA and SF are both California and merge; Houston is Texas and does not.
      expect(threats).toHaveLength(2);
      expect(map['US-CA>FR']?.count).toBe(2);
      expect(map['US-TX>FR']?.count).toBe(1);
    });

    it('groups scattered coordinates within one country into a single threat', () => {
      const attacks: Attack[] = [
        { id: 'paris', from: { lat: 48.86, lng: 2.35 }, to: 'US-NY' },
        { id: 'lyon', from: { lat: 45.76, lng: 4.84 }, to: 'US-NY' },
        { id: 'marseille', from: { lat: 43.3, lng: 5.37 }, to: 'US-NY' },
      ];

      const threats = aggregateAttacks(attacks, { index, config: { minCount: 1 } });

      expect(threats).toHaveLength(1);
      expect(threats[0]).toMatchObject({ id: 'FR>US-NY', count: 3 });
    });

    it('collapses states into their country at country granularity', () => {
      const attacks: Attack[] = [
        { id: 'la', from: { lat: 34.05, lng: -118.24 }, to: 'FR' },
        { id: 'hou', from: { lat: 29.76, lng: -95.37 }, to: 'FR' },
      ];

      const threats = aggregateAttacks(attacks, { index, config: { granularity: 'country' } });

      expect(threats).toHaveLength(1);
      expect(threats[0]?.id).toBe('US>FR');
      expect(threats[0]?.count).toBe(2);
    });
  });

  describe('performance', () => {
    it('resolves 1000 distinct points well inside a frame budget', () => {
      const points = Array.from({ length: 1000 }, (_, i) => ({
        lat: -60 + (i % 120),
        lng: -180 + ((i * 7) % 360),
      }));

      const start = performance.now();
      for (const p of points) index.resolve(p, true);
      const elapsed = performance.now() - start;

      // Generous bound: this asserts the bbox prefilter exists at all. Without
      // it this is ~230 polygon walks per point and blows well past this.
      expect(elapsed).toBeLessThan(500);
    });

    it('makes repeated origins much cheaper than distinct ones', () => {
      const repeated = { lat: 34.05, lng: -118.24 };
      index.resolve(repeated, true); // warm

      const start = performance.now();
      for (let i = 0; i < 10_000; i++) index.resolve(repeated, true);
      const elapsed = performance.now() - start;

      // 10k cache hits should be a handful of ms.
      expect(elapsed).toBeLessThan(100);
    });
  });
});
