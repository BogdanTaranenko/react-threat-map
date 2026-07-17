/**
 * Generates the bundled geo artifacts from Natural Earth source data.
 *
 *   node scripts/build-geo.mjs
 *
 * Inputs (devDependencies, never shipped):
 *   - world-atlas/countries-110m.json   Natural Earth 1:110m countries, TopoJSON
 *   - world-atlas/countries-10m.json    Natural Earth 1:10m — anchor source only
 *   - us-atlas/states-10m.json          Census/Natural Earth US states, TopoJSON
 *   - iso-3166                          Authoritative code tables
 *
 * Outputs (committed, shipped):
 *   - src/geo/data/countries.json       TopoJSON, ids rewritten to ISO alpha-2
 *   - src/geo/data/states.json          TopoJSON, ids rewritten to ISO 3166-2
 *   - src/geo/data/regions.json         Inline lookup table: codes + anchor points
 *
 * Why rewrite ids in place rather than emit GeoJSON: the TopoJSON arc/quantization
 * encoding is what makes these files small, and it survives untouched if we only
 * swap the `id` and `properties` on each geometry. Decoding to GeoJSON to write it
 * back out would roughly triple the payload for no benefit.
 *
 * Why two country resolutions — this is the important subtlety:
 *
 *   Natural Earth's 1:110m file omits every country too small to draw at world
 *   scale. That is correct for *drawing* (Singapore is sub-pixel on a 900 px-wide
 *   map) but catastrophic for *resolving*: it left 75 of 249 ISO countries —
 *   including Singapore, Hong Kong, Malta, and Bahrain — with no anchor, so an
 *   attack from any of them was dropped with a warning. Those are real, common
 *   attack origins.
 *
 *   So the two concerns are decoupled. Anchors come from the 1:10m file, which
 *   covers 238 countries; drawn geometry stays 1:110m. A threat from Singapore
 *   now resolves and renders its line correctly — Singapore is simply not painted
 *   as its own landmass at world scale, which is what you want anyway. The 1:10m
 *   file is a devDependency read at build time; not one byte of it ships.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { feature } from 'topojson-client';
import { geoArea, geoCentroid } from 'd3-geo';
import { iso31661, iso31661NumericToAlpha2, iso31662 } from 'iso-3166';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../src/geo/data');

/**
 * Territories that world-atlas draws but ISO 3166-1 has not assigned a numeric
 * code to. We give each a code from the ISO user-assigned range (XA–XZ), which
 * is reserved precisely for this. `XK` for Kosovo is the de facto standard used
 * by the EU, IMF, and SWIFT; the other two are our own and are documented as
 * such in the README.
 */
const UNASSIGNED_BY_NAME = {
  Kosovo: { alpha2: 'XK', alpha3: 'XKX', name: 'Kosovo' },
  'N. Cyprus': { alpha2: 'XN', alpha3: 'XNC', name: 'Northern Cyprus' },
  Somaliland: { alpha2: 'XS', alpha3: 'XSO', name: 'Somaliland' },
};

/** us-atlas names that differ from the ISO 3166-2 subdivision name. */
const STATE_NAME_ALIASES = {
  'commonwealth of the northern mariana islands': 'US-MP',
};

/**
 * A handful of countries whose largest-polygon centroid still lands somewhere
 * unhelpful, corrected by hand. Kept deliberately tiny — the largest-polygon
 * heuristic covers everything else.
 */
const CENTROID_OVERRIDES = {
  // Largest polygon spans Siberia, placing the anchor ~4000km from population.
  RU: { lat: 55.75, lng: 37.62 },
  // Mainland centroid sits in the sparse north; anchor on the populated south.
  NO: { lat: 59.91, lng: 10.75 },
};

/**
 * Territories that ISO 3166-1 assigns a code to but Natural Earth models as part
 * of their parent country, so they have no polygon of their own to derive an
 * anchor from at any resolution.
 *
 * Most matter: Réunion, Martinique, Guadeloupe, French Guiana and Mayotte are
 * French *departments* with their own populations and IP allocations, and a feed
 * that geolocates to `RE` should not be silently dropped just because Natural
 * Earth draws it inside `FR`. The uninhabited ones (Bouvet, Cocos, Christmas,
 * Svalbard, Tokelau) are included for the same reason it is worth being able to
 * say the coverage is total: a partial promise is one consumers have to test.
 *
 * Coordinates are the conventional centre of each territory.
 */
/**
 * Small countries that need 1:10m geometry rather than 1:50m.
 *
 * These are enclaves embedded in a much larger neighbour, where the border is
 * the *only* thing distinguishing them and 1:50m does not resolve it: at 50m
 * Hong Kong is a 39-point blob that misses Hong Kong Island entirely, so a
 * Victoria Harbour coordinate falls through to `CN`. Hong Kong and Macao are
 * both major hosting hubs and routinely appear in real attack feeds, so getting
 * them wrong is not academic.
 *
 * Costs ~5 kB gzipped for the whole set — worth it here, and not worth it for
 * the 54 island nations that 1:50m already separates cleanly by open water.
 */
const HIGH_DETAIL_ENCLAVES = new Set(['HK', 'MO', 'SM', 'VA', 'LI', 'AD', 'MC']);

const DETACHED_TERRITORIES = [
  { alpha2: 'BQ', name: 'Bonaire, Sint Eustatius and Saba', lat: 12.1784, lng: -68.2385 },
  { alpha2: 'BV', name: 'Bouvet Island', lat: -54.4208, lng: 3.3464 },
  { alpha2: 'CC', name: 'Cocos (Keeling) Islands', lat: -12.1642, lng: 96.871 },
  { alpha2: 'CX', name: 'Christmas Island', lat: -10.4475, lng: 105.6904 },
  { alpha2: 'GF', name: 'French Guiana', lat: 3.9339, lng: -53.1258 },
  { alpha2: 'GP', name: 'Guadeloupe', lat: 16.265, lng: -61.551 },
  { alpha2: 'MQ', name: 'Martinique', lat: 14.6415, lng: -61.0242 },
  { alpha2: 'RE', name: 'Réunion', lat: -21.1151, lng: 55.5364 },
  { alpha2: 'SJ', name: 'Svalbard and Jan Mayen', lat: 77.875, lng: 20.9752 },
  { alpha2: 'TK', name: 'Tokelau', lat: -9.2002, lng: -171.8484 },
  { alpha2: 'YT', name: 'Mayotte', lat: -12.8275, lng: 45.1662 },
];

const round = (n, places = 4) => Number(n.toFixed(places));

/**
 * Anchor point for a feature: the centroid of its largest-area polygon.
 *
 * A plain `geoCentroid` of a multipolygon averages every part, which drags the
 * United States into the Pacific (Alaska + Hawaii) and France into the Atlantic
 * (overseas departments). Using only the biggest polygon resolves to the
 * mainland in every such case.
 */
function anchorPoint(geometry) {
  if (geometry.type === 'Polygon') {
    const [lng, lat] = geoCentroid(geometry);
    return { lat, lng };
  }
  if (geometry.type !== 'MultiPolygon') {
    throw new Error(`Unsupported geometry type: ${geometry.type}`);
  }

  let best = null;
  let bestArea = -1;
  for (const coordinates of geometry.coordinates) {
    const polygon = { type: 'Polygon', coordinates };
    const area = geoArea(polygon); // steradians; sign-independent
    if (area > bestArea) {
      bestArea = area;
      best = polygon;
    }
  }
  const [lng, lat] = geoCentroid(best);
  return { lat, lng };
}

function assertFinite(point, label) {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    throw new Error(`Non-finite anchor computed for ${label}: ${JSON.stringify(point)}`);
  }
}

/* ------------------------------- countries -------------------------------- */

const alpha3ByAlpha2 = new Map(iso31661.map((c) => [c.alpha2, c.alpha3]));

/**
 * Identify a world-atlas country geometry.
 *
 * @returns `{alpha2, alpha3, name}`, or `null` for geometries we deliberately skip.
 */
function identify(geometry) {
  const rawName = geometry.properties?.name ?? '(unnamed)';
  const numeric = geometry.id == null ? null : String(geometry.id).padStart(3, '0');
  const alpha2 = numeric ? iso31661NumericToAlpha2[numeric] : undefined;

  if (alpha2) {
    return {
      alpha2,
      alpha3: alpha3ByAlpha2.get(alpha2) ?? null,
      // Prefer Natural Earth's short display name ("Bolivia") over ISO's formal
      // one ("Bolivia (Plurinational State of)") — better for map labels.
      name: rawName,
    };
  }

  const fallback = UNASSIGNED_BY_NAME[rawName];
  if (fallback) return { alpha2: fallback.alpha2, alpha3: fallback.alpha3, name: fallback.name };

  // The 1:10m file carries a long tail of disputed/unrecognised areas with no
  // ISO code. They are not addressable by a region code, so there is nothing to
  // put in the table — skip rather than invent an identity for them.
  return null;
}

/**
 * Build the resolution table from the 1:10m file.
 *
 * This is the anchor source for *every* country, including the ~60 too small to
 * appear at 1:110m. See the header note on why the two resolutions are decoupled.
 */
function buildRegionTable(regions) {
  const topo = require('world-atlas/countries-10m.json');
  const decoded = feature(topo, topo.objects.countries);

  const seen = new Set();
  for (const f of decoded.features) {
    const identity = identify(f);
    if (!identity || seen.has(identity.alpha2)) continue;
    seen.add(identity.alpha2);

    const anchor = CENTROID_OVERRIDES[identity.alpha2] ?? anchorPoint(f.geometry);
    assertFinite(anchor, `${identity.alpha2} (${identity.name})`);

    regions.push({
      id: identity.alpha2,
      n: identity.name,
      k: 'country',
      c: identity.alpha2,
      a3: identity.alpha3,
      lat: round(anchor.lat),
      lng: round(anchor.lng),
    });
  }

  for (const territory of DETACHED_TERRITORIES) {
    if (seen.has(territory.alpha2)) continue; // Natural Earth grew a polygon for it
    seen.add(territory.alpha2);
    regions.push({
      id: territory.alpha2,
      n: territory.name,
      k: 'country',
      c: territory.alpha2,
      a3: alpha3ByAlpha2.get(territory.alpha2) ?? null,
      lat: territory.lat,
      lng: territory.lng,
    });
  }

  return seen;
}

/**
 * Geometry for the countries the 1:110m file omits, taken from 1:50m.
 *
 * Without this, reverse-resolving a bare `{lat, lng}` is not merely incomplete —
 * it is *wrong*. At 1:110m the Johor Strait does not exist, so Singapore is drawn
 * inside the Malay peninsula and a Singapore coordinate point-in-polygons into
 * `MY`. Hong Kong lands in `CN`, Malta and Bahrain in open ocean. Silently
 * attributing an attack to the wrong country is worse than returning nothing,
 * and worst of all in a security display.
 *
 * Emitted as plain GeoJSON rather than merged into the TopoJSON topology: these
 * polygons share no borders with anything (they are islands and enclaves), so
 * TopoJSON's arc-sharing would buy nothing, and merging topologies at build time
 * would need `topojson-server` and a lot more machinery for no gain.
 *
 * 1:50m rather than 1:10m for most of them — 22 kB gzipped against 104 kB, for
 * detail far finer than a world map needs and finer than geo-IP accuracy anyway.
 * The exception is {@link HIGH_DETAIL_ENCLAVES}.
 */
function buildSmallCountries(drawn) {
  const sources = {
    '50m': feature(require('world-atlas/countries-50m.json'), require('world-atlas/countries-50m.json').objects.countries),
    '10m': feature(require('world-atlas/countries-10m.json'), require('world-atlas/countries-10m.json').objects.countries),
  };

  const features = [];
  const seen = new Set();

  // Enclaves first, so their finer geometry is the one that gets used.
  for (const level of ['10m', '50m']) {
    for (const f of sources[level].features) {
      const identity = identify(f);
      if (!identity || drawn.has(identity.alpha2) || seen.has(identity.alpha2)) continue;

      const wantsDetail = HIGH_DETAIL_ENCLAVES.has(identity.alpha2);
      if (level === '10m' && !wantsDetail) continue;

      seen.add(identity.alpha2);
      features.push({
        type: 'Feature',
        id: identity.alpha2,
        properties: { name: identity.name, kind: 'country', countryCode: identity.alpha2 },
        geometry: f.geometry,
      });
    }
  }

  return { data: { type: 'FeatureCollection', features }, count: features.length };
}

/**
 * Prepare the 1:110m geometry we actually ship, rewriting ids to ISO alpha-2.
 */
function buildCountryGeometry(resolvable) {
  const topo = require('world-atlas/countries-110m.json');

  const kept = [];
  for (const geometry of topo.objects.countries.geometries) {
    const identity = identify(geometry);
    if (!identity) {
      throw new Error(`Country "${geometry.properties?.name}" in the 110m file has no ISO code and no override.`);
    }
    if (!resolvable.has(identity.alpha2)) {
      // A country we can draw but not name would be unreachable by region code
      // and unattributable on reverse lookup — the tables must not disagree.
      throw new Error(`Country ${identity.alpha2} has 110m geometry but no entry in the region table.`);
    }

    geometry.id = identity.alpha2;
    geometry.properties = { name: identity.name, kind: 'country', countryCode: identity.alpha2 };
    kept.push(identity.alpha2);
  }

  return { topo, count: kept.length };
}

/* --------------------------------- states --------------------------------- */

function buildStates(regions) {
  const topo = require('us-atlas/states-10m.json');
  const codeByName = new Map(
    iso31662.filter((s) => s.parent === 'US').map((s) => [s.name.toLowerCase(), s.code]),
  );

  const decoded = feature(topo, topo.objects.states);
  const anchorById = new Map();
  for (const f of decoded.features) {
    anchorById.set(String(f.id), anchorPoint(f.geometry));
  }

  for (const geometry of topo.objects.states.geometries) {
    const rawName = geometry.properties?.name ?? '(unnamed)';
    const lower = rawName.toLowerCase();
    const code = codeByName.get(lower) ?? STATE_NAME_ALIASES[lower];
    if (!code) {
      throw new Error(`US state "${rawName}" (id=${geometry.id}) has no ISO 3166-2 code.`);
    }

    const anchor = anchorById.get(String(geometry.id));
    if (!anchor) throw new Error(`No anchor for state ${code} (${rawName})`);
    assertFinite(anchor, `${code} (${rawName})`);

    geometry.id = code;
    geometry.properties = { name: rawName, kind: 'state', countryCode: 'US' };

    regions.push({
      id: code,
      n: rawName,
      k: 'state',
      c: 'US',
      a3: null,
      lat: round(anchor.lat),
      lng: round(anchor.lng),
    });
  }

  return { topo, count: topo.objects.states.geometries.length };
}

/* ---------------------------------- main ---------------------------------- */

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const regions = [];
  const resolvable = buildRegionTable(regions);
  const countries = buildCountryGeometry(resolvable);
  const small = buildSmallCountries(new Set(countries.topo.objects.countries.geometries.map((g) => g.id)));
  const states = buildStates(regions);

  // The `land` object is a dissolved outline we never draw; dropping it saves
  // ~30% of the country file.
  delete countries.topo.objects.land;
  delete states.topo.objects.nation;

  const ids = new Set();
  for (const r of regions) {
    if (ids.has(r.id)) throw new Error(`Duplicate region id: ${r.id}`);
    ids.add(r.id);
  }

  const files = [
    ['countries.json', countries.topo],
    ['small-countries.json', small.data],
    ['states.json', states.topo],
    ['regions.json', regions],
  ];

  for (const [name, data] of files) {
    const path = resolve(OUT_DIR, name);
    writeFileSync(path, JSON.stringify(data));
    const kb = (readFileSync(path).byteLength / 1024).toFixed(1);
    console.log(`  ${name.padEnd(16)} ${kb.padStart(7)} kB`);
  }

  const resolvableCountries = regions.filter((r) => r.k === 'country').length;
  console.log(
    `\n  ${resolvableCountries} countries resolvable, ${countries.count} drawn at 1:110m ` +
      `+ ${small.count} small at 1:50m/1:10m, ${states.count} US states, ${regions.length} regions total`,
  );

  // Guard the regression this script was originally written with: deriving the
  // table from the 1:110m drawing data left 75 real countries — Singapore and
  // Hong Kong among them — unresolvable, so their attacks were silently dropped.
  // Every ISO-assigned country must be addressable by code.
  const resolvableIds = new Set(regions.filter((r) => r.k === 'country').map((r) => r.id));
  const unresolvable = iso31661
    .filter((c) => c.state === 'assigned' && !resolvableIds.has(c.alpha2))
    .map((c) => `${c.alpha2} (${c.name})`);

  if (unresolvable.length > 0) {
    throw new Error(
      `${unresolvable.length} ISO 3166-1 countries have no anchor and would be dropped at runtime:\n` +
        `  ${unresolvable.join('\n  ')}\n` +
        'Add them to DETACHED_TERRITORIES.',
    );
  }
  console.log(`  ✓ all ${resolvableIds.size} ISO 3166-1 assigned countries resolve`);
}

main();
