import { describe, expect, it } from 'vitest';

import { getRegionById, listRegions, lookupRegionCode } from '../../src/geo/regions.js';
import { resolveLocation } from '../../src/geo/resolve.js';

describe('lookupRegionCode', () => {
  it('resolves ISO alpha-2 country codes', () => {
    expect(lookupRegionCode('FR')?.name).toBe('France');
    expect(lookupRegionCode('JP')?.name).toBe('Japan');
  });

  it('resolves ISO alpha-3 country codes', () => {
    expect(lookupRegionCode('FRA')?.id).toBe('FR');
    expect(lookupRegionCode('USA')?.id).toBe('US');
  });

  it('resolves ISO 3166-2 US state codes', () => {
    expect(lookupRegionCode('US-CA')?.name).toBe('California');
    expect(lookupRegionCode('US-TX')?.name).toBe('Texas');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(lookupRegionCode('  us-ca  ')?.id).toBe('US-CA');
    expect(lookupRegionCode('fra')?.id).toBe('FR');
  });

  describe('the documented country/state ambiguity', () => {
    it('resolves a bare code that is a real country code to the country', () => {
      // "CA" is both Canada and California. The country wins, as documented.
      expect(lookupRegionCode('CA')?.name).toBe('Canada');
      expect(lookupRegionCode('CA')?.kind).toBe('country');
    });

    it('falls back to a US state for a bare code that is not a country code', () => {
      expect(lookupRegionCode('TX')?.name).toBe('Texas');
      expect(lookupRegionCode('TX')?.kind).toBe('state');
    });

    it('always resolves the unambiguous hyphenated form to the state', () => {
      expect(lookupRegionCode('US-CA')?.name).toBe('California');
    });
  });

  it('returns undefined for unknown or malformed codes', () => {
    for (const code of ['', '   ', 'ZZ', 'ZZZ', 'NOT_A_REGION', 'US-ZZ', 'F']) {
      expect(lookupRegionCode(code), code).toBeUndefined();
    }
  });

  it('exposes a plausible anchor for every region', () => {
    for (const region of listRegions()) {
      expect(Number.isFinite(region.anchor.lat), region.id).toBe(true);
      expect(Math.abs(region.anchor.lat), region.id).toBeLessThanOrEqual(90);
      expect(Math.abs(region.anchor.lng), region.id).toBeLessThanOrEqual(180);
    }
  });

  it('anchors mainland rather than averaging distant territories', () => {
    // Regression on the largest-polygon heuristic: a naive centroid puts the US
    // in the Pacific (Alaska + Hawaii) and France in the Atlantic (overseas
    // departments). Assert they land on their actual mainlands.
    const us = lookupRegionCode('US')!.anchor;
    expect(us.lat).toBeGreaterThan(30);
    expect(us.lat).toBeLessThan(50);
    expect(us.lng).toBeGreaterThan(-110);
    expect(us.lng).toBeLessThan(-85);

    const fr = lookupRegionCode('FR')!.anchor;
    expect(fr.lat).toBeGreaterThan(42);
    expect(fr.lat).toBeLessThan(51);
    expect(fr.lng).toBeGreaterThan(-5);
    expect(fr.lng).toBeLessThan(8);
  });

  it('covers all 50 states plus DC', () => {
    const states = listRegions().filter((r) => r.kind === 'state');
    expect(states.length).toBeGreaterThanOrEqual(51);
    for (const code of ['US-CA', 'US-TX', 'US-NY', 'US-AK', 'US-HI', 'US-DC', 'US-WY']) {
      expect(getRegionById(code), code).toBeDefined();
    }
  });

  it('assigns user-range codes to territories ISO has not numbered', () => {
    expect(lookupRegionCode('XK')?.name).toBe('Kosovo');
  });

  describe('coverage of small countries', () => {
    it('resolves countries too small to draw at world scale', () => {
      // Regression: the region table was originally derived from the 1:110m
      // drawing data, which omits every sub-pixel country. That silently dropped
      // attacks from 75 real countries — including two major datacenter hubs.
      // Resolution and drawing are now decoupled; see scripts/build-geo.mjs.
      const cases: Array<[string, string]> = [
        ['SG', 'Singapore'],
        ['HK', 'Hong Kong'],
        ['MT', 'Malta'],
        ['BH', 'Bahrain'],
        ['MO', 'Macao'],
        ['LI', 'Liechtenstein'],
        ['MC', 'Monaco'],
        ['MV', 'Maldives'],
        ['BB', 'Barbados'],
      ];

      for (const [code, name] of cases) {
        expect(lookupRegionCode(code)?.name, code).toBe(name);
      }
    });

    it('anchors Singapore and Hong Kong at their real locations', () => {
      const sg = lookupRegionCode('SG')!.anchor;
      expect(sg.lat).toBeCloseTo(1.36, 0);
      expect(sg.lng).toBeCloseTo(103.8, 0);

      const hk = lookupRegionCode('HK')!.anchor;
      expect(hk.lat).toBeCloseTo(22.4, 0);
      expect(hk.lng).toBeCloseTo(114.2, 0);
    });

    it('resolves overseas territories that Natural Earth folds into their parent', () => {
      // Réunion and Martinique are French departments with their own IP space; a
      // feed geolocating to them must not be dropped just because the map draws
      // them inside France.
      expect(lookupRegionCode('RE')?.name).toBe('Réunion');
      expect(lookupRegionCode('MQ')?.name).toBe('Martinique');
      expect(lookupRegionCode('RE')!.anchor.lat).toBeCloseTo(-21.1, 0);
    });

    it('resolves every country in the table by both alpha-2 and alpha-3', () => {
      for (const region of listRegions().filter((r) => r.kind === 'country')) {
        expect(lookupRegionCode(region.id)?.id, region.id).toBe(region.id);
        if (region.alpha3) {
          expect(lookupRegionCode(region.alpha3)?.id, region.alpha3).toBe(region.id);
        }
      }
    });
  });
});

describe('resolveLocation', () => {
  it('resolves a region code to its anchor', () => {
    const result = resolveLocation('US-CA');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.region.id).toBe('US-CA');
    expect(result.value.point).toEqual(lookupRegionCode('US-CA')!.anchor);
  });

  it('keeps exact coordinates while trusting an explicit region hint', () => {
    const result = resolveLocation({ lat: 34.05, lng: -118.24, region: 'US-CA' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The point is the caller's, not the region's anchor.
    expect(result.value.point).toEqual({ lat: 34.05, lng: -118.24 });
    expect(result.value.region.id).toBe('US-CA');
  });

  it('marks bare coordinates unknown when no index is available', () => {
    const result = resolveLocation({ lat: 34.05, lng: -118.24 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.region.kind).toBe('unknown');
    expect(result.value.point).toEqual({ lat: 34.05, lng: -118.24 });
  });

  it('keeps the coordinate when the region hint is bogus rather than discarding the point', () => {
    const result = resolveLocation({ lat: 34.05, lng: -118.24, region: 'NONSENSE' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.point).toEqual({ lat: 34.05, lng: -118.24 });
    expect(result.value.region.kind).toBe('unknown');
  });

  it('rejects an unknown region code with an actionable message', () => {
    const result = resolveLocation('ATLANTIS');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/Unknown region code "ATLANTIS"/);
    expect(result.reason).toMatch(/ISO 3166/);
  });

  it('rejects out-of-range and non-finite coordinates', () => {
    const bad = [
      { lat: 91, lng: 0 },
      { lat: -91, lng: 0 },
      { lat: 0, lng: 181 },
      { lat: 0, lng: -181 },
      { lat: NaN, lng: 0 },
      { lat: 0, lng: Infinity },
    ];

    for (const point of bad) {
      expect(resolveLocation(point).ok, JSON.stringify(point)).toBe(false);
    }
  });

  it('rejects a malformed location object', () => {
    const result = resolveLocation({ foo: 'bar' } as never);
    expect(result.ok).toBe(false);
  });

  it('accepts the boundary coordinates', () => {
    for (const point of [{ lat: 90, lng: 180 }, { lat: -90, lng: -180 }, { lat: 0, lng: 0 }]) {
      expect(resolveLocation(point).ok, JSON.stringify(point)).toBe(true);
    }
  });
});
