# react-threat-map

[![CI](https://github.com/BogdanTaranenko/react-threat-map/actions/workflows/ci.yml/badge.svg)](https://github.com/BogdanTaranenko/react-threat-map/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/react-threat-map.svg)](https://www.npmjs.com/package/react-threat-map)
[![license](https://img.shields.io/npm/l/react-threat-map.svg)](./LICENSE)

Animated cyberattack threats on a static world map, for React. Aggregates attacks by
origin region — with **US states as first-class origins** — so a busy feed reads as a
map instead of a hairball.

**[→ Live demo](https://bogdantaranenko.github.io/react-threat-map/)**

```tsx
import { ThreatMap } from 'react-threat-map';

<ThreatMap attacks={[{ from: 'CN', to: 'US-CA', severity: 'high' }]} />;
```

- **Fast.** 500+ concurrent animated threats at 120fps in the bundled demo. Draw calls are
  bounded by the number of distinct *styles*, so past a few dozen threats they stop growing
  entirely — 500 threats and 2000 threats cost identical draw calls.
- **Aggregates intelligently.** Many attacks from California collapse into one heavier
  line; California and Texas stay separate. Fully configurable, or turn it off.
- **No API keys, no tiles.** Boundaries are bundled Natural Earth data, lazy-loaded.
- **22.2 kB gzipped** main bundle. Geometry is a separate chunk you only pay for on mount.
- **Strictly typed**, with TSDoc on every public export.
- **Unopinionated.** No CSS, no state manager, no styling library. Two peer-free runtime
  deps.

---

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Aggregation](#aggregation)
- [Customization](#customization)
- [API reference](#api-reference)
- [Performance](#performance)
- [Examples](#examples)
- [Design decisions](#design-decisions)
- [License](#license)

---

## Install

```bash
npm install react-threat-map
```

React 18+ is a peer dependency:

```json
{ "peerDependencies": { "react": ">=18.0.0" } }
```

---

## Quick start

The only required prop is `attacks`. The map sizes itself to its container, loads its own
geography, aggregates by origin region, and animates:

```tsx
import { ThreatMap, type Attack } from 'react-threat-map';

const attacks: Attack[] = [
  { id: '1', from: 'CN', to: 'US-CA', severity: 'high' },
  { id: '2', from: 'RU', to: 'US-NY', severity: 'critical' },
  { id: '3', from: 'BR', to: 'FR', severity: 'medium' },
];

export function Dashboard() {
  return (
    <div style={{ width: 900 }}>
      <ThreatMap attacks={attacks} />
    </div>
  );
}
```

### Describing where an attack came from

`from` and `to` each accept three interchangeable shapes, so you can pass whatever your
data already has:

```tsx
// 1. A region code — cheapest. No geometry needed to place it.
{ from: 'FR', to: 'US-CA' }

// 2. Exact coordinates. Reverse-resolved to a region for aggregation.
{ from: { lat: 34.05, lng: -118.24 }, to: 'FR' }

// 3. Both — exact placement AND a free aggregation key.
//    Best option if your feed already carries geo-IP region data.
{ from: { lat: 34.05, lng: -118.24, region: 'US-CA' }, to: 'FR' }
```

Region codes accept ISO 3166-1 alpha-2 (`"FR"`), alpha-3 (`"FRA"`), and ISO 3166-2 US
state codes (`"US-CA"`). All 252 ISO-assigned countries resolve, including ones too small
to draw at world scale — `"SG"`, `"HK"`, `"MO"`, `"MT"`, `"MC"`. Bare coordinates inside
them resolve correctly too: a point in Singapore returns `SG`, not Malaysia.

> **A note on bare two-letter codes.** `"CA"` is both Canada and California. Bare codes
> always resolve to the **country**, so `"CA"` is Canada. `"TX"` resolves to Texas
> because no country uses that code. Use the unambiguous `"US-CA"` form for states.

### Streaming feeds

`attacks` is the complete current set. Attacks that disappear from the array fade out:

```tsx
const [attacks, setAttacks] = useState<Attack[]>([]);

useEffect(() => {
  const socket = new WebSocket('wss://your-feed');
  socket.onmessage = (event) => {
    const attack = JSON.parse(event.data) as Attack;
    // Keep a bounded window; older attacks fade out automatically.
    setAttacks((previous) => [...previous.slice(-499), attack]);
  };
  return () => socket.close();
}, []);

<ThreatMap attacks={attacks} />;
```

Give each attack a stable `id`. It is how an in-flight animation stays attached to its
threat across re-renders.

---

## Aggregation

This is the feature the library exists for. A feed with 500 attacks contains maybe 30
meaningful origin→destination relationships; drawing 500 overlapping lines hides that.
Aggregation collapses attacks sharing an origin region into a single, visually heavier
threat.

```tsx
// Two attacks from California, one from Texas — all aimed at France.
const attacks = [
  { id: 'a', from: { lat: 34.05, lng: -118.24, region: 'US-CA' }, to: 'FR' },
  { id: 'b', from: { lat: 37.77, lng: -122.42, region: 'US-CA' }, to: 'FR' },
  { id: 'c', from: 'US-TX', to: 'FR' },
];

// Renders 2 threats:
//   California → France  (count 2, thicker)
//   Texas      → France  (count 1)
<ThreatMap attacks={attacks} />;
```

### It groups on regions, not coordinates

Two attacks from opposite ends of California still aggregate, because the key is the
*region*, not the point. When you pass bare `{lat, lng}`, the library reverse-resolves
each point to its region via point-in-polygon before grouping.

### US states are first-class

At the default `granularity: 'auto'`, US origins group by **state** and everything else
by **country**. California and Texas are distinct aggregates; France stays one aggregate.

| `granularity` | California | Texas | France |
| --- | --- | --- | --- |
| `'auto'` *(default)* | `US-CA` | `US-TX` | `FR` |
| `'country'` | `US` | `US` | `FR` |
| `'state'` | `US-CA` | `US-TX` | `FR` |

This does **not** require loading state borders — `regions.showStates` controls *drawing*
them and is independent.

### Visual weight scales with count

An aggregate's `intensity` multiplies line width, glow, and head size. The default ramp is
logarithmic (`1 + log₂(count) × 0.5`, clamped to `[1, 6]`) because attack volume is
heavily long-tailed — a linear ramp would let one 500-attack region smear across the whole
map next to a hairline:

| count | 1 | 2 | 10 | 100 | 500 | 5000 |
| --- | --- | --- | --- | --- | --- | --- |
| intensity | 1.0 | 1.5 | 2.7 | 4.3 | 5.5 | 6.0 |

```tsx
// Linear instead:
<ThreatMap attacks={attacks} aggregation={{ scale: (count) => 1 + count / 10 }} />

// Merge, but size every line identically:
<ThreatMap attacks={attacks} aggregation={{ scale: () => 1 }} />
```

Use `weight` when one row stands for many events — aggregation sums weights as well as
counting rows:

```tsx
{ from: 'CN', to: 'US-CA', weight: 500 }  // 500 blocked packets, one row
```

### What counts as "the same threat"

By default, aggregation groups by origin **and** destination, so France→US and
France→Japan stay separate lines. Grouping on origin alone would collapse them into one
line with no coherent destination to draw to.

```tsx
// One line per origin region, whatever it targets.
// The destination becomes that origin's most frequent target.
<ThreatMap attacks={attacks} aggregation={{ groupBy: 'origin' }} />
```

### Thresholds, caps, and turning it off

```tsx
// Don't merge until at least 5 attacks share an origin; smaller
// groups render as individual lines.
<ThreatMap attacks={attacks} aggregation={{ minCount: 5 }} />

// Never draw more than 40 lines — keeps the heaviest.
<ThreatMap attacks={attacks} aggregation={{ maxGroups: 40 }} />

// One line per attack.
<ThreatMap attacks={attacks} aggregation={false} />
```

### Custom grouping

`key` overrides grouping entirely. Return `null` to render an attack on its own:

```tsx
// Group by origin country AND attack type.
<ThreatMap
  attacks={attacks}
  aggregation={{ key: (attack, from) => `${from.id}:${attack.type}` }}
/>

// Never aggregate critical attacks — show every one individually.
<ThreatMap
  attacks={attacks}
  aggregation={{
    key: (attack, from, to) => (attack.severity === 'critical' ? null : `${from.id}>${to.id}`),
  }}
/>
```

### Severity of an aggregate

An aggregate takes the **max** severity of its members: a group with one critical and
forty low attacks renders critical. For a security display, under-reporting the worst
event in a bucket is the more dangerous failure. Override with `severity`:

```tsx
// Use the most common severity instead of the worst.
<ThreatMap attacks={attacks} aggregation={{ severity: (all) => mode(all) }} />
```

### Using aggregation without the map

`aggregateAttacks` is a pure function — no React, no canvas, no async. Reuse it for a
table view, a CSV export, or a test:

```ts
import { aggregateAttacks } from 'react-threat-map';

const threats = aggregateAttacks(attacks, { config: { granularity: 'country' } });
threats.forEach((t) => console.log(t.fromRegion.name, t.count, t.severity));
```

---

## Customization

### Theme

Pass any subset; it merges over the defaults.

```tsx
<ThreatMap
  attacks={attacks}
  theme={{
    ocean: '#eef2f7',
    land: '#cfd9e6',
    border: '#ffffff',
    severityColors: { critical: '#dc2626', high: '#ea580c' },
  }}
/>
```

`severityColors` merges per-key, so overriding `critical` leaves `low`/`medium`/`high`
intact. Custom severity strings work — add a matching key and use it:

```tsx
<ThreatMap
  attacks={[{ from: 'CN', to: 'US', severity: 'nation-state' }]}
  theme={{ severityColors: { 'nation-state': '#a855f7' } }}
/>
```

### Lines and animation

```tsx
<ThreatMap
  attacks={attacks}
  line={{ curvature: 0.35, width: 2, glow: 0.8, trailLength: 0.25 }}
  animation={{ speed: 1.2, easing: 'easeInOutCubic', stagger: 0.5 }}
/>
```

Set `curvature: 0` for straight geodesics, or negative to bow the other way. Arc height is
capped at a third of the map height so intercontinental arcs stay on screen.

`animation={{ enabled: false }}` schedules **no** `requestAnimationFrame` loop at all —
arcs render statically and the component costs nothing per frame. The map also respects
`prefers-reduced-motion` automatically; opt out with
`animation={{ respectReducedMotion: false }}`.

### Projections

```tsx
<ThreatMap attacks={attacks} projection="orthographic" />
```

Built in: `naturalEarth1` (default), `equirectangular`, `mercator`, `orthographic`. Or
pass any [d3-geo](https://github.com/d3/d3-geo) projection and it will be fitted for you:

```tsx
import { geoRobinson } from 'd3-geo-projection';

<ThreatMap attacks={attacks} projection={geoRobinson()} />;
```

### Boundaries

```tsx
<ThreatMap attacks={attacks} regions={{ showStates: true, showGraticule: true }} />
```

### Render hooks

`renderThreat` and `renderRegion` let you draw anything. Return `true` if you handled it,
or `false` to fall through to the built-in renderer.

```tsx
// Label heavy aggregates, but let the library still draw the lines.
<ThreatMap
  attacks={attacks}
  renderThreat={(ctx, { threat, points, alpha }) => {
    if (threat.count < 20) return false;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fff';
    ctx.font = '600 10px system-ui';
    ctx.fillText(`${threat.count}`, points[0] + 4, points[1] - 4);
    return false;
  }}
/>
```

```tsx
// Heat-shade countries by attack volume.
<ThreatMap
  attacks={attacks}
  renderRegion={(ctx, { feature, path, weight, theme }) => {
    ctx.beginPath();
    path(feature);
    ctx.fillStyle = weight > 0 ? `hsl(0 80% ${20 + Math.min(weight, 40)}%)` : theme.land;
    ctx.fill();
    return true;
  }}
/>
```

The context is pre-transformed for device pixel ratio, so draw in CSS pixels. Both hooks
are wrapped in save/restore and are error-isolated: a hook that throws is disabled for the
rest of the frame and the built-in renderer takes over.

> `renderThreat` opts that threat out of style batching, costing it a draw call of its
> own. Fine for tens of threats; if you need custom drawing on hundreds, prefer restyling
> via `theme`/`line`.

### Interaction

```tsx
<ThreatMap
  attacks={attacks}
  onThreatClick={(threat) => console.log(threat.count, 'from', threat.fromRegion.name)}
  onThreatHover={(threat) => setTooltip(threat)}
/>
```

Hit testing runs against the real arc geometry, with a hit radius that scales with line
thickness. `onThreatHover` fires only when the hovered threat *changes*, not on every
pointer pixel. Without any handler the canvas is `pointer-events: none` and never
intercepts clicks meant for your own UI.

### Sizing

| You provide | Result |
| --- | --- |
| Nothing | Fills container width; height from the projection's aspect ratio |
| A CSS height (class or `style`) | Fills the container in both axes |
| `width` only | Height derived from the projection's aspect ratio |
| `width` + `height` | Exactly that, in CSS pixels |

The map ships no CSS and never imposes a size beyond a fallback aspect ratio.

### Self-hosting geo data

```tsx
import { loadGeoData } from 'react-threat-map/geo';

// Preload during app boot so the map paints instantly on mount.
void loadGeoData({ states: true });

// Or supply your own boundaries entirely.
<ThreatMap attacks={attacks} geo={async () => fetch('/geo.json').then((r) => r.json())} />;
```

---

## API reference

### `<ThreatMap>`

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `attacks` | `Attack[]` | — | **Required.** The current attack set. |
| `width` | `number` | container width | CSS pixels. |
| `height` | `number` | from aspect ratio | CSS pixels. |
| `projection` | `ProjectionSpec` | `'naturalEarth1'` | Name or a d3-geo projection. |
| `theme` | `Partial<ThreatMapTheme>` | `defaultTheme` | Colors. |
| `line` | `Partial<LineStyleConfig>` | `defaultLineStyle` | Arc geometry and styling. |
| `animation` | `Partial<AnimationConfig>` | `defaultAnimation` | Animation. |
| `regions` | `Partial<RegionsConfig>` | `defaultRegions` | Which boundaries to draw. |
| `aggregation` | `Partial<AggregationConfig> \| false` | `defaultAggregation` | Grouping. `false` disables. |
| `renderThreat` | `ThreatRenderer` | — | Custom threat drawing. |
| `renderRegion` | `RegionRenderer` | — | Custom region drawing. |
| `geo` | `GeoData \| (() => Promise<GeoData>)` | bundled | Supply or preload geometry. |
| `onThreatClick` | `(threat, event) => void` | — | Click handler. |
| `onThreatHover` | `(threat \| null, event) => void` | — | Hover handler. |
| `onError` | `(error: ThreatMapError) => void` | dev console | Recoverable errors. |
| `className` / `style` | | — | Applied to the wrapper. |
| `ariaLabel` | `string` | `'Cyberattack threat map'` | Accessible name. |

### `Attack`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `from` | `AttackLocation` | — | **Required.** Origin. |
| `to` | `AttackLocation` | — | **Required.** Destination. |
| `id` | `string` | derived | Stable identity. Recommended for streaming. |
| `timestamp` | `number` | — | Epoch ms. |
| `type` | `string` | — | Free-form classification. |
| `severity` | `Severity` | `'medium'` | `low` \| `medium` \| `high` \| `critical` \| custom. |
| `weight` | `number` | `1` | Relative importance; summed by aggregation. |
| `meta` | `TMeta` | — | Your payload, passed through untouched. |

### `Threat`

What aggregation produces and hooks/handlers receive.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Group key, stable across frames. |
| `from` / `to` | `LatLng` | Resolved coordinates. |
| `fromRegion` / `toRegion` | `ResolvedRegion` | `{ id, name, kind, countryCode }`. |
| `count` | `number` | Underlying attacks. `1` when unaggregated. |
| `totalWeight` | `number` | Sum of member weights. |
| `severity` | `Severity` | Max across members, by default. |
| `intensity` | `number` | Visual weight multiplier, `1`–`6`. |
| `attacks` | `Attack[]` | The attacks folded into this threat. |

### `AggregationConfig`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | Master switch. |
| `granularity` | `'auto' \| 'state' \| 'country'` | `'auto'` | Origin specificity. |
| `groupBy` | `'origin-destination' \| 'origin'` | `'origin-destination'` | What is "the same threat". |
| `key` | `AggregationKeyFn` | — | Full override. `null` opts an attack out. |
| `minCount` | `number` | `2` | Minimum group size to merge. |
| `maxGroups` | `number` | unlimited | Cap, keeping the heaviest. |
| `scale` | `IntensityScale` | log ramp | count → visual weight. |
| `severity` | `AggregationSeverityFn` | max | How an aggregate picks its severity. |

### `LineStyleConfig`

| Field | Default | Description |
| --- | --- | --- |
| `curvature` | `0.22` | Arc height as a fraction of chord length. `0` is flat. |
| `width` | `1.2` | Baseline stroke width, before `intensity`. |
| `trackOpacity` | `0.28` | Opacity of the full arc behind the head. |
| `trailOpacity` | `0.95` | Opacity of the lit trail. |
| `trailLength` | `0.18` | Trail length as a fraction of the path. |
| `glow` | `0.5` | Glow strength, `0`–`1`. |
| `headRadius` | `2` | Head dot radius, before `intensity`. |
| `showOrigin` | `true` | Static marker at each origin. |
| `showImpact` | `true` | Ripple where a head lands. |
| `segments` | `48` | Straight pieces per arc. |

### `AnimationConfig`

| Field | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | `false` schedules no rAF loop at all. |
| `speed` | `0.5` | Full traversals per second. |
| `easing` | `'easeInOutQuad'` | Name or `(t) => number`. |
| `stagger` | `1` | Phase spread, `0`–`1`. `0` is lockstep. |
| `loop` | `true` | Restart on completion. |
| `fadeIn` / `fadeOut` | `400` / `600` | Milliseconds. |
| `respectReducedMotion` | `true` | Honor `prefers-reduced-motion`. |

### `ThreatMapTheme`

`ocean`, `land`, `border`, `borderWidth`, `stateBorder`, `stateBorderWidth`,
`severityColors`, `headColor`, `originColor`, `impactColor`.

### `RegionsConfig`

`showCountries` (`true`), `showStates` (`false`), `showGraticule` (`false`),
`graticuleColor`, `showSphere` (`true`).

### Exported functions

| Export | Description |
| --- | --- |
| `aggregateAttacks(attacks, options)` | The pure aggregation function. |
| `lookupRegionCode(code)` | `"us-ca"` → `{ id, name, kind, anchor, … }`. |
| `getRegionById(id)` | Exact lookup by canonical id. |
| `listRegions()` | Every known country and US state. |
| `resolveLocation(location, index?, preferStates?)` | Location → point + region. |
| `loadGeoData(options)` | From `react-threat-map/geo`. Preload boundaries. |
| `defaultTheme`, `defaultLineStyle`, `defaultAnimation`, `defaultRegions`, `defaultAggregation` | Frozen defaults, safe to spread. |
| `defaultIntensityScale`, `maxSeverity`, `severityRank`, `regionKey`, `SEVERITY_ORDER` | Aggregation internals, exported for reuse. |

### Error handling

The library never throws at render. Recoverable problems go to `onError`:

| `kind` | Meaning |
| --- | --- |
| `geo-load` | Geometry chunk failed to load. Threats still render on a blank map. |
| `resolve` | An attack's `from`/`to` could not be resolved. That attack is skipped. |
| `render` | A render hook threw. It is disabled for the frame; the built-in renderer takes over. |

Without a handler these are logged in development and silent in production.

---

## Performance

Measured on the bundled heavy-load demo — 500+ threats streaming at ~20/sec, on a modern
laptop:

> **120 fps**, with five maps animating on the same page.

The technique that gets there is **style batching**. The naive Canvas loop issues one
`stroke()` per threat per frame — and that is what usually makes people conclude Canvas is
too slow and reach for WebGL. Instead, threats are bucketed by `(color, width, alpha)`,
each bucket accumulates every member's geometry into a single `Path2D`, and each bucket
issues one `stroke()`.

The effect is that **draw calls stop growing with threat count**. Measured on the worst
realistic case — every threat a different severity, intensity, and animation phase:

| threats | draw calls | accumulate + paint |
| --- | --- | --- |
| 50 | 163 | 0.3 ms |
| 500 | 173 | 0.5 ms |
| 2000 | 173 | 1.5 ms |

Past a few dozen threats every style bucket is already occupied, so quadrupling the
threats adds no draw calls at all — only the linear, cheap work of walking more cached
geometry. The plateau is asserted in the test suite rather than merely claimed:

```ts
expect(drawCallsFor(2000)).toBe(drawCallsFor(500));
```

Alongside it:

- **Geometry is precomputed**, once per layout, never per frame. The loop only walks
  cached `Float32Array` buffers.
- **Glow is a double-stroke**, not `shadowBlur` — visually equivalent on a line and
  roughly an order of magnitude cheaper.
- **The per-threat path allocates nothing**, so the GC has no reason to interrupt an
  animation.
- **The base map is a separate canvas**, rasterized once and never touched by the loop.

### Getting the most out of it

- **Give attacks stable `id`s.** Identity drives animation continuity.
- **Pass `region` alongside coordinates** when you have it — it skips point-in-polygon
  entirely.
- **Bound your feed.** `maxGroups` caps rendered threats; slicing your array caps
  resolution work.
- **`animation={{ enabled: false }}`** removes the rAF loop completely.

---

## Examples

**[bogdantaranenko.github.io/react-threat-map](https://bogdantaranenko.github.io/react-threat-map/)** —
the demo below, hosted. Deployed from `main` on every push.

It covers basic usage, 500+ streaming attacks with a live FPS counter, one country under
fire from five origins at different volumes, aggregation strategies side by side, custom
theming with render hooks, and raw-coordinate reverse geocoding with hover.

To run it locally against the library source, so edits hot-reload:

```bash
git clone https://github.com/BogdanTaranenko/react-threat-map
cd react-threat-map
npm install
npm run build          # generates geo data + builds the library
cd examples/demo
npm install
npm run dev
```

---

## Design decisions

[DECISIONS.md](./DECISIONS.md) covers the load-bearing choices and their tradeoffs:
why `d3-geo` + Canvas over MapLibre/Leaflet/react-simple-maps, why Canvas 2D over SVG and
WebGL, how the Natural Earth data is bundled and split, and why resolving and drawing
deliberately use different datasets.

## Data

Boundaries from [Natural Earth](https://www.naturalearthdata.com/) — public domain, no
attribution required — via `world-atlas` and `us-atlas`, preprocessed at build time.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, repo layout,
and the two non-obvious things (generated-but-committed geo data, and why resolving and
drawing use different datasets).

```bash
npm install
npm run geo        # regenerate bundled geo data from Natural Earth
npm test           # 228 tests
npm run typecheck  # includes the type-contract suite
npm run build
```

## License

MIT © [Bogdan Taranenko](https://github.com/BogdanTaranenko)
