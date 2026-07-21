# Technology Decisions

This document records the load-bearing technical choices behind `react-threat-map`,
and the tradeoffs each one accepts. It is written for someone deciding whether this
library fits their use case, or considering changing one of these choices later.

---

## 1. Map rendering technology: `d3-geo` projections + Canvas 2D

**Chosen:** `d3-geo` for projection math only, with our own Canvas 2D renderer for the
base map geometry. No map framework.

### Options evaluated

| Option | Verdict |
| --- | --- |
| **MapLibre GL / Mapbox GL** | Rejected. Designed for interactive, tiled, zoomable slippy maps. ~800 kB of runtime for a map that never moves, and the good basemap styles want a tile endpoint — which the brief explicitly rules out. Its strengths (tile paging, zoom LOD, terrain) are all things a static world map does not need. |
| **Leaflet** | Rejected. Fundamentally a raster-tile viewer. Rendering our own GeoJSON through it means fighting its DOM/layer model, and we would ship a pan/zoom engine we do not use. |
| **`react-simple-maps`** | Rejected, though closest in spirit. It is a thin React/SVG wrapper over `d3-geo` — meaning we would take on its dependency tree and component model to get code we can write in ~150 lines, and still end up with an SVG base map we would have to reach around for the threat layer. It also pulls in `d3-zoom`/`d3-selection` for interaction we do not want. Its projection handling is exactly `d3-geo`, so we take that directly. |
| **`d3-geo` + custom Canvas renderer** | **Chosen.** |
| **Hand-rolled projection math** | Rejected. Writing and testing correct Natural Earth / Mercator / equirectangular forward projections, plus antimeridian clipping, is a real amount of subtle work that `d3-geo` has already done correctly for a decade. |

### Why this one

- **`d3-geo` is projection math, not a framework.** It exposes `geoPath` with a Canvas
  context target, so the same code path draws country outlines to Canvas that would
  draw them to SVG. It brings no DOM opinions, no state management, and no styling.
- **Tree-shakeable and small.** We import four symbols (`geoPath`, `geoNaturalEarth1`,
  `geoInterpolate`, `geoContains`-adjacent helpers). Bundlers drop the rest.
- **The static-map requirement is a gift here.** Because the base map never pans or
  zooms, it is drawn **once** per size/theme change onto its own canvas and then left
  alone. All per-frame cost belongs to the threat layer. A tile framework's entire
  value proposition is amortizing work we do not have.
- **Customization stays ours.** Region fill/stroke/hover and the `renderRegion` hook are
  plain draw calls we control, not a style spec we have to translate into.

### Tradeoff accepted

No pan/zoom, and no basemap imagery. That is a deliberate reading of "static world map".
If a consumer later needs a slippy map, this library is the wrong tool and they should
reach for MapLibre — that is a better outcome than us growing into a worse MapLibre.

---

## 2. Threat layer: Canvas 2D on a second stacked canvas

**Chosen:** A dedicated `<canvas>` layered over the base map canvas, cleared and redrawn
each `requestAnimationFrame`, with **draw calls batched by style bucket**.

### Options evaluated

**SVG — rejected.** 500 animated threats means 500+ live DOM nodes whose attributes
change every frame. That is style recalculation and layout on every tick; it falls over
well below the target. SVG is the right answer for ~20 threats and the wrong answer here.

**WebGL — rejected, but it is the escape hatch.** WebGL would raise the ceiling to tens
of thousands of threats. It costs: a shader pipeline, manual line tessellation (WebGL has
no usable thick-line primitive), context-loss handling, and a `renderThreat` hook that
consumers could no longer write in ordinary drawing code. The target is *hundreds* of
threats at 60fps, and Canvas 2D clears that bar with room to spare — the bundled demo runs
500+ streaming threats at **120fps** with five maps animating on one page, and the layer
still only spends ~1.5 ms per frame at 2000 threats. Paying WebGL's complexity tax for
headroom nobody asked for is the wrong trade. If someone genuinely needs 10k+ threats, the
renderer is isolated behind `src/render/` and could be swapped without touching the public
API.

**Canvas 2D — chosen.**

### The thing that makes Canvas 2D fast enough

The naive Canvas loop — `beginPath()`/`stroke()` per threat — costs one draw call per
threat per frame, and *that* is what usually makes people conclude "Canvas is too slow,
we need WebGL". We do not do that. Instead:

1. **Geometry is precomputed, not recomputed.** Each threat's arc is projected and
   flattened into a screen-space polyline **once**, cached, and invalidated only on
   resize/projection/curvature change — not per frame. Per frame we only *walk* it.
2. **Draw calls are batched by style bucket.** Threats are grouped by
   `(color, width bucket, alpha step)`. Each bucket accumulates every member's geometry
   into a single `Path2D` and issues **one** `stroke()`. Cost therefore scales with the
   number of distinct *styles*, which is bounded — not with threat count, which is not.
   Measured on the worst realistic case (every threat a different severity, intensity,
   and phase): 50 threats cost 163 draw calls, 500 cost 173, and **2000 also cost 173**,
   at 0.3 ms / 0.5 ms / 1.5 ms of CPU respectively. Past a few dozen threats every bucket
   is already occupied and the draw-call count simply stops rising.
3. **Glow is faked with a double-stroke, not `shadowBlur`.** `shadowBlur` is one of the
   most expensive operations in Canvas 2D and is applied per-stroke. Drawing each bucket
   twice — wide + low alpha, then narrow + full alpha — is visually equivalent for a glow
   line and roughly an order of magnitude cheaper.
4. **The render loop allocates nothing.** No per-frame arrays, objects, or closures, so
   we do not hand the GC a reason to stutter mid-animation.

Base map and threats are separate canvases specifically so that the ~300 country/state
paths are rasterized once and never re-touched by the animation loop.

---

## 3. Geo data: Natural Earth, lazily loaded, with an inline centroid table

**Source:** [Natural Earth](https://www.naturalearthdata.com/) (public domain), consumed
via the `world-atlas` and `us-atlas` TopoJSON builds and **pre-processed at build time**
into artifacts we ship. Natural Earth is the standard answer here: public domain (no
attribution obligation to push onto consumers), cartographer-curated, and available at
the exact generalization level a small static map wants.

- Countries: `world-atlas` `countries-110m` (1:110m — right detail level for a world map
  a few hundred pixels tall; 1:50m is wasted bytes at this size).
- US states: `us-atlas` `states-10m`, resampled during preprocessing.

**Format: TopoJSON, decoded at runtime with `topojson-client`.** TopoJSON stores shared
borders once instead of twice and quantizes coordinates to integers, which is ~60–70%
smaller than equivalent GeoJSON before compression and still meaningfully smaller after.
`topojson-client` is ~3 kB gzipped, zero-dependency, and MIT — a good trade for that.

### Bundling strategy: split by how it is used

This is the important part. The data splits cleanly along an access pattern:

- **Boundary geometry** is only needed to *draw*, and is **lazy-loaded** via dynamic
  `import()` into its own chunk. It never lands in a consumer's main bundle, and a
  consumer who imports only `aggregateAttacks` never downloads it at all. US state
  geometry is a *separate* chunk again, fetched only when it would change what renders.
- **The region table** (canonical codes + anchor coordinates) is needed to *resolve* —
  turn `"US-CA"` into a coordinate — which must be synchronous and must work without the
  geometry present. So it stays in the main bundle. This is what lets aggregation and
  region resolution be pure, testable functions with no async and no fetch.

Measured from an actual `npm run build` (not estimates):

| Artifact | gzipped | When it loads |
| --- | --- | --- |
| Main bundle — component, renderer, aggregation, region table | **22.2 kB** | On import |
| `countries` chunk | **40.0 kB** | On mount, in parallel with first paint |
| `small-countries` chunk | **28.5 kB** | Alongside `countries` — see below |
| `states` chunk | **37.8 kB** | Only when state borders or coordinate→state resolution are needed |

The load chain is two dynamic hops — `index.js` → `geo.js` → `countries-*.js` — so a
bundler that respects `import()` code-splits all of it away from the entry automatically.
Nothing in the main bundle statically references geometry.

The state chunk is genuinely conditional: `<ThreatMap>` only asks for it when
`regions.showStates` is on, or when the feed contains bare `{lat, lng}` origins that
would need point-in-polygon to reach state granularity. A feed that uses `"US-CA"`-style
codes gets full state-level aggregation without ever fetching it.

Consumers who want to self-host or preload can pass `geo` directly and skip our loader.

### Resolving and drawing use different datasets, on purpose

The obvious build is to derive everything — geometry *and* the region table — from
the one 1:110m file. That is what this library did first, and it was quietly broken.

Natural Earth's 1:110m file contains 177 countries because it omits every country
too small to draw at world scale. That is the right call for *drawing*: Singapore is
sub-pixel on a 900 px-wide map. But deriving the *resolution* table from it too left
**75 of 249 ISO countries with no anchor** — including Singapore, Hong Kong, Bahrain
and Malta. An attack from any of them resolved to nothing and was dropped with a
warning. Those are among the most active hosting regions on the internet; a threat
map that cannot draw a line from Singapore is broken for its actual purpose.

So the two concerns use different sources:

- **Drawing** uses 1:110m — 177 countries, the ones that read at world scale.
- **Resolving** uses 1:10m — 238 countries, plus a small hand-curated table for the
  11 territories (Réunion, Martinique, Mayotte…) that Natural Earth models inside
  their parent country and so have no polygon of their own at any resolution.

All of it is a build-time read; the 1:10m file is a devDependency and not one byte
of it ships. The result is that **all 252 ISO 3166-1 assigned countries resolve**,
while the drawn map stays at the resolution that actually looks right. A threat from
Singapore renders its line correctly — Singapore just isn't painted as its own
landmass, which is what you want anyway.

`scripts/build-geo.mjs` asserts total ISO coverage and fails the build if any
assigned country lacks an anchor, so this cannot regress silently.

### The same problem, again, for reverse lookup — and why it cost 28.5 kB

Fixing the *code* path (`"SG"` → coordinate) left the *coordinate* path still broken,
and broken in a nastier way. Reverse lookup point-in-polygons against the drawn
geometry, and at 1:110m the Johor Strait is not resolved — Singapore's island is drawn
as part of the Malay peninsula. So `{lat: 1.35, lng: 103.82}` did not fail; it
confidently returned **Malaysia**. Hong Kong returned **China**. Malta and Bahrain
returned ocean.

Returning the wrong sovereign country is worse than returning nothing, and worst of all
on a security display, where the whole output is an attribution claim. Bare coordinates
are a first-class documented input, so "pass a region code instead" is not an answer.

Hence a third artifact: `small-countries.json`, holding geometry for the 61 countries
absent from 1:110m, lazy-loaded beside the countries chunk.

- **Plain GeoJSON, not TopoJSON.** These are islands and enclaves that share no borders,
  so TopoJSON's arc-sharing would save nothing and cost a build-time topology merge.
- **1:50m for 54 of them.** 22 kB gzipped versus 104 kB for 1:10m, and open water already
  separates an island nation cleanly from everything else.
- **1:10m for 7 enclaves** (`HK`, `MO`, `SM`, `VA`, `LI`, `AD`, `MC`) — +5 kB. These sit
  *inside* a much larger neighbour, so the border is the only thing distinguishing them,
  and 1:50m does not resolve it: Hong Kong at 1:50m is a 39-point blob that misses Hong
  Kong Island entirely, dropping Victoria Harbour back into `CN`. Hong Kong and Macao are
  major hosting hubs and appear in real feeds constantly.
- **Small countries are tested first**, which is load-bearing: a Singapore point is inside
  both Singapore's 1:50m polygon and Malaysia's 1:110m one, and the specific answer has to
  win.

The trade is 28.5 kB on a lazy, cached chunk against silently misattributing attacks from
Singapore, Hong Kong, Macao, Malta, Bahrain, Luxembourg, Monaco and ~54 others. Tests
cover both directions — the microstates resolving correctly, *and* their large neighbours
(Shenzhen, Guangzhou, Johor Bahru, Nice, Zurich, Rome) not being stolen by them.

### Centroid choice: largest-polygon centroid, not true centroid

A naive `geoCentroid` on a multipolygon country puts the United States' anchor point in
the Pacific (pulled west by Alaska and Hawaii) and France's in the Atlantic (pulled by
overseas territories). Both are useless as the visual origin of a threat line.

Instead the build script computes the centroid of each feature's **largest-area polygon**,
which resolves to the mainland landmass in every one of these cases. A small curated
override table handles the remaining awkward cases. Centroids are computed at build time
and shipped as data, so no runtime geometry or math is needed to resolve a region code.

### Reverse resolution (raw `{lat, lng}` → region)

When a consumer passes raw coordinates but wants aggregation, we must determine which
region the point falls in. Testing a point against ~300 features with point-in-polygon is
too slow at 500 attacks/frame-batch, so we:

1. Reject by precomputed bounding box first (removes ~99% of candidates in one compare).
2. Run exact point-in-polygon only on survivors (typically 1–3).
3. Memoize by rounded coordinate, since streaming attack feeds repeat origins heavily.

This requires geometry, so it is async and only active once the geo chunk resolves.
Attacks given an explicit region code (`"US-CA"`) skip all of it.

---

## 4. Runtime dependencies

Every runtime dependency, and why it earns its place:

| Package | Justification |
| --- | --- |
| `d3-geo` | Projections, `geoPath` (which targets a Canvas context directly), and `geoInterpolate`. Reimplementing correct projections and antimeridian clipping is weeks of subtle work. We import ~7 symbols; the rest tree-shakes. |
| `topojson-client` | Decodes the TopoJSON we ship. Zero-dependency, MIT, ~3 kB gzipped — and it pays for itself many times over in transfer size. Lands in the lazy geo chunk, never the main bundle. |

Both are declared `external`, so consumers dedupe them against their own copies of d3
rather than shipping a second one.

`react` is a **peer** dependency (>=16.14.0), never bundled.

The floor is 16.14.0, not 16.8.0 (hooks) as one might expect: the compiled output uses
the automatic JSX runtime, so it imports `react/jsx-runtime`, and that entry point first
ships in **16.14.0**. On 16.8–16.13 the package installs and then fails at bundle time on
an unresolved module, so those versions must stay outside the range.

Nothing in the library needs more than that floor — it uses only `useState`, `useEffect`,
`useRef`, `useMemo`, and `useCallback`. The range was originally `>=18` for no recorded
reason, which excluded working consumers on React 16.14/17; widened in 0.2.1 after
verifying typecheck and a mount/re-render/unmount render pass on 16.14, 17, 18, and 19.

Supporting that range is also why the public types import `CSSProperties`, `MouseEvent`,
`ReactElement`, and `RefObject` **by name** from `react` rather than reaching through the
`React` UMD global or the global `JSX` namespace. A bare `JSX.Element` in an emitted `.d.ts`
resolves against whatever `@types/react` the consumer has — and `@types/react@19` removed
the global `JSX` namespace, so it broke React 19 consumers compiling with
`skipLibCheck: false`. Named type imports are identical across `@types/react` 16 to 19.

Deliberately **not** dependencies: no state manager, no styling library, no CSS-in-JS, no
animation library, no `d3-selection`/`d3-zoom`/`d3-scale`. The library ships zero CSS —
it renders into a canvas you size — so it imposes no styling solution on the consumer.

---

## 5. API stability notes

Two decisions in the public API were close calls and are worth flagging, since they are
the ones most likely to be revisited:

**Default aggregation groups by origin *and* destination, not origin alone.** The brief
specifies the origin region as the aggregation key. Taken literally, attacks
France→US and France→Japan would collapse into one threat — which has no coherent
destination to draw to. Since the stated *purpose* of aggregation is to stop overlapping
lines, and those two lines do not overlap, the default is `groupBy: 'origin-destination'`:
one line per origin→destination region pair. Pure origin collapsing is available via
`groupBy: 'origin'` (destination becomes the origin's most frequent target), and
`aggregation.key` overrides grouping entirely.

**An aggregate takes the *max* severity of its members, not the mean or mode.** A group
containing one critical and forty low attacks renders critical. For a security display,
under-reporting the worst thing in a bucket is the more dangerous failure mode. This is
overridable via `aggregation.severity`.

---

## 6. Same-place threats render as a loop, not a point

An attack can legitimately begin and end in the same place. Germany has no subdivisions in
the region table, so a domestic German incident is `DE → DE` and both ends resolve to one
country anchor. The same happens for `US-CA → US-CA`, and for two hosts given identical
city coordinates.

Geometrically this is a zero-length chord, and the arc builder's whole model — sample a
geodesic, push each sample perpendicular to the chord by a sine-weighted lift — degenerates:
there is no direction to travel and no perpendicular to lift along. Every sample lands on
the same pixel.

### What that used to look like

Nothing, essentially. The renderer accumulates polylines and skips any arc of zero length,
so a same-place threat drew no track and no trail. What remained was the origin dot, the
head sitting on top of it, and the impact ripple firing in place. It also could not be
hovered: hit-testing measures distance to line segments, and there were none.

That is a defensible reading — the library has one coordinate for California, so it cannot
draw a journey across it — but it is the wrong one for a threat map. A domestic incident is
an event, and it disappeared into a dot indistinguishable from a static origin marker.

### What it does instead

`buildArc` detects the degenerate case and emits a circle tangent to the shared point: the
origin marker sits on the point, the head travels the loop, and the ripple fires back on the
point as it closes. It is ordinary geometry, so batching, fading, and hit-testing all work
with no special cases downstream.

Three parameter choices, all of which were the actual decisions:

**The threshold is half a pixel, not exact equality.** Endpoints do not have to be *equal*
to be indistinguishable. Two hosts in one city, or any pair on a far-zoomed view, project
sub-pixel apart. A half-pixel line cannot be seen or hovered, so drawing it as a line is
strictly worse than drawing it as a loop. The cost is that two genuinely distinct points
can render as a loop when the viewport is zoomed far enough out.

**The radius is clamped in pixels (6–18), scaled off the map's lift ceiling.** A radius
derived from the geometry would be zero, and one derived from the viewport alone would
vanish on a world map — which is exactly where a same-city attack most needs to stay
visible.

**The radius ignores `curvature`.** Tempting, since curvature controls arc height
elsewhere. But curvature is the height of a lift applied to a chord, and a self-loop has no
chord. Coupling them would make `curvature: 0` — a reasonable choice for flat, straight
lines — silently erase every self-directed threat on the map.

### Tradeoff accepted

Consumers upgrading from 0.1.x see new animated loops wherever their feed contains
same-region attacks that previously rendered as static dots. This is why the change went
out as a minor bump rather than a patch.
