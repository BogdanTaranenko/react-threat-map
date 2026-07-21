/**
 * The demo scenarios.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { geoAlbersUsa, geoMercator } from 'd3-geo';
import {
  ThreatMap,
  defaultTheme,
  type Attack,
  type GeoProjectionLike,
  type RegionRenderer,
  type Threat,
  type ThreatMapTheme,
} from 'react-threat-map';

import {
  DOMESTIC_FLOWS,
  GHANA_CAMPAIGN,
  makeAttacks,
  makeAttack,
  makeCampaignAttacks,
  makeCoordinateAttacks,
  makeDomesticAttacks,
} from './feed';
import { Fps } from './Fps';

/* ------------------------------ 1. basic usage ----------------------------- */

/**
 * The headline case: attacks in, map out. No configuration at all.
 */
export function BasicDemo(): JSX.Element {
  const attacks = useMemo<Attack[]>(
    () => [
      { id: '1', from: 'CN', to: 'US-CA', severity: 'high' },
      { id: '2', from: 'RU', to: 'US-NY', severity: 'critical' },
      { id: '3', from: 'BR', to: 'FR', severity: 'medium' },
      { id: '4', from: 'IR', to: 'GB', severity: 'high' },
      { id: '5', from: 'KP', to: 'JP', severity: 'critical' },
      { id: '6', from: 'US-TX', to: 'DE', severity: 'low' },
    ],
    [],
  );

  return (
    <Panel
      title="Basic usage"
      description="Six attacks, no configuration. Region codes resolve to coordinates automatically."
      code={`<ThreatMap attacks={attacks} />`}
    >
      <ThreatMap attacks={attacks} />
    </Panel>
  );
}

/* ------------------------------ 2. heavy load ------------------------------ */

/**
 * 500+ attacks streaming in, to demonstrate the performance claim.
 *
 * The FPS counter is the point of this demo: it is the visible evidence for the
 * Canvas-over-SVG decision in DECISIONS.md §2.
 */
export function HeavyLoadDemo(): JSX.Element {
  const [attacks, setAttacks] = useState<Attack[]>(() => makeAttacks(500));
  const [streaming, setStreaming] = useState(true);

  useEffect(() => {
    if (!streaming) return;

    // Add ~20/sec and drop the oldest, holding a steady ~500 in flight — the
    // shape of a real SOC feed.
    const timer = setInterval(() => {
      setAttacks((previous) => [...previous.slice(-480), ...Array.from({ length: 20 }, makeAttack)]);
    }, 1000);

    return () => clearInterval(timer);
  }, [streaming]);

  return (
    <Panel
      title="Heavy load — 500+ concurrent threats"
      description={
        <>
          {attacks.length} attacks streaming at ~20/sec, aggregated by origin region. Watch the FPS counter: draw
          calls scale with the number of distinct styles, not with the number of threats.
        </>
      }
      code={`<ThreatMap attacks={attacks} regions={{ showStates: true }} />`}
      actions={
        <button className="btn" onClick={() => setStreaming((s) => !s)}>
          {streaming ? 'Pause stream' : 'Resume stream'}
        </button>
      }
    >
      <Fps />
      <ThreatMap attacks={attacks} regions={{ showStates: true }} animation={{ speed: 0.6 }} />
    </Panel>
  );
}

/* ---------------------------- 3. custom theming ---------------------------- */

const LIGHT_THEME: Partial<ThreatMapTheme> = {
  ocean: '#eef2f7',
  land: '#cfd9e6',
  border: '#ffffff',
  borderWidth: 0.7,
  stateBorder: '#e2e8f0',
  severityColors: {
    low: '#0891b2',
    medium: '#ca8a04',
    high: '#ea580c',
    critical: '#dc2626',
  },
  headColor: '#1e293b',
};

/**
 * A light theme, a different projection, straighter lines, and a `renderThreat`
 * hook that labels the heaviest aggregates.
 */
export function ThemingDemo(): JSX.Element {
  const attacks = useMemo(() => makeAttacks(160), []);

  return (
    <Panel
      title="Custom theming & render hooks"
      description="A light palette, equirectangular projection, flatter arcs, and a renderThreat hook labelling aggregates of 8+."
      code={`<ThreatMap
  attacks={attacks}
  projection="equirectangular"
  theme={{ ocean: '#eef2f7', land: '#cfd9e6', ... }}
  line={{ curvature: 0.08, width: 1.6, glow: 0.2 }}
  renderThreat={(ctx, { threat, points, alpha }) => {
    if (threat.count < 8) return false;      // built-in renderer handles it
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#0f172a';
    ctx.font = '600 10px system-ui';
    ctx.fillText(String(threat.count), points[0] + 4, points[1] - 4);
    return false;                            // still draw the line underneath
  }}
/>`}
    >
      <ThreatMap
        attacks={attacks}
        projection="equirectangular"
        theme={LIGHT_THEME}
        line={{ curvature: 0.08, width: 1.6, glow: 0.2, trackOpacity: 0.35 }}
        animation={{ speed: 0.4, easing: 'linear' }}
        renderThreat={(ctx, { threat, points, alpha }) => {
          if (threat.count < 8) return false;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = '#0f172a';
          ctx.font = '600 10px system-ui, sans-serif';
          ctx.fillText(String(threat.count), (points[0] as number) + 4, (points[1] as number) - 4);
          return false;
        }}
      />
    </Panel>
  );
}

/* -------------------------- 4. aggregation compare ------------------------- */

/**
 * The same feed rendered with aggregation on and off, side by side.
 *
 * This is the clearest possible statement of what aggregation buys you: the
 * left map is legible, the right one is a hairball.
 */
export function AggregationDemo(): JSX.Element {
  const [mode, setMode] = useState<'auto' | 'country' | 'off'>('auto');
  const attacks = useMemo(() => makeAttacks(300), []);

  const aggregation = mode === 'off' ? (false as const) : { granularity: mode, minCount: 1 as const };

  const counts = { auto: 'US states stay separate', country: 'US collapses to one origin', off: 'one line per attack' };

  return (
    <Panel
      title="Aggregation strategies"
      description={`300 attacks, ${counts[mode]}. Compare the legibility of each mode.`}
      code={
        mode === 'off'
          ? `<ThreatMap attacks={attacks} aggregation={false} />`
          : `<ThreatMap attacks={attacks} aggregation={{ granularity: '${mode}' }} />`
      }
      actions={
        <div className="segmented">
          {(['auto', 'country', 'off'] as const).map((option) => (
            <button
              key={option}
              className={`btn ${mode === option ? 'btn-active' : ''}`}
              onClick={() => setMode(option)}
            >
              {option === 'auto' ? 'auto (state)' : option === 'country' ? 'country' : 'disabled'}
            </button>
          ))}
        </div>
      }
    >
      <ThreatMap attacks={attacks} aggregation={aggregation} regions={{ showStates: mode === 'auto' }} />
    </Panel>
  );
}

/* ------------------------ 5. reverse geocoding + hover --------------------- */

/**
 * Raw coordinates with no region codes, aggregated via point-in-polygon, plus
 * hover interaction.
 */
export function CoordinatesDemo(): JSX.Element {
  const attacks = useMemo(() => makeCoordinateAttacks(240), []);
  const [hovered, setHovered] = useState<Threat | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  /**
   * Position the tooltip by writing a transform straight to the node.
   *
   * Two reasons it does not go through `onThreatHover` or through state:
   *
   * - `onThreatHover` fires only when the hovered threat *changes*, not on every
   *   mousemove. Driving position from it pins the tooltip wherever the pointer
   *   first touched a line, and it then sits still as you move along it.
   * - Putting the cursor in state would re-render on every mouse pixel, which is
   *   exactly what the library's fire-on-change hover contract exists to avoid.
   *
   * So: content comes from state (changes rarely), position is written directly
   * (changes constantly, and needs no React involvement).
   */
  const handleMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const tooltip = tooltipRef.current;
    if (!tooltip) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left + 12;
    const y = event.clientY - rect.top + 12;
    tooltip.style.transform = `translate(${x}px, ${y}px)`;
  };

  return (
    <Panel
      title="Raw coordinates & interaction"
      description="240 attacks given only {lat, lng} — no region codes. The library reverse-resolves each point to its state or country, then aggregates. Hover a line."
      code={`<ThreatMap
  attacks={attacks}                       // from: { lat: 34.05, lng: -118.24 }
  onThreatHover={(threat) => setHovered(threat)}
/>`}
    >
      <div style={{ position: 'relative' }} onMouseMove={handleMove}>
        <ThreatMap attacks={attacks} regions={{ showStates: true }} onThreatHover={(threat) => setHovered(threat)} />
        {/*
          Always mounted, only hidden — so `handleMove` always has a node to
          position, and the tooltip never flashes at the origin for one frame on
          first hover.
        */}
        <div ref={tooltipRef} className="tooltip" style={{ visibility: hovered ? 'visible' : 'hidden' }}>
          {hovered ? (
            <>
              <strong>
                {hovered.fromRegion.name} → {hovered.toRegion.name}
              </strong>
              <div>
                {hovered.count} attack{hovered.count === 1 ? '' : 's'} · {hovered.severity}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

/* -------------------------- 6. one target, highlighted --------------------- */

/** The country under attack. */
const TARGET = 'GH';

/** Ghana's highlight color. Deliberately outside `severityColors`, so it reads as "target", not "severity". */
const TARGET_COLOR = '#f97316';

/**
 * The one source of severity colours for this demo.
 *
 * The map is given it explicitly and the legend reads it, so the swatches cannot
 * disagree with the lines. Reading `defaultTheme` in the legend while the map
 * used its own theme would look identical today and silently start lying the
 * moment anyone themed this map — and a legend that lies is worse than none.
 *
 * Note this is hoisted for *single-sourcing*, not for referential stability:
 * `theme`/`line`/`regions`/`aggregation` are compared by value, so writing them
 * inline is free. Only the render hooks need hoisting — see {@link highlightTarget}.
 */
const CAMPAIGN_THEME: Partial<ThreatMapTheme> = { severityColors: defaultTheme.severityColors };

/**
 * Repaint the target country and leave every other region to the built-in
 * renderer.
 *
 * Defined at module scope, not inline: `renderRegion` is a dependency of the
 * base map's redraw effect, so a fresh closure each render would re-rasterize
 * all 177 outlines on every render.
 */
const highlightTarget: RegionRenderer = (ctx, { feature, id, path }) => {
  if (id !== TARGET) return false;

  // No save/restore is done around this hook, and the countries that follow are
  // drawn in one batched fill — leaking a shadow would smear across all of them.
  ctx.save();
  ctx.beginPath();
  path(feature);
  // Ghana covers a few pixels at world scale, so the halo does the work the fill
  // is too small to do on its own.
  ctx.shadowColor = TARGET_COLOR;
  ctx.shadowBlur = 18;
  ctx.fillStyle = TARGET_COLOR;
  ctx.fill();
  ctx.restore();

  return true;
};

/**
 * Five origins, five very different attack volumes, one target country.
 *
 * Two things are on display: aggregation turning every attack in
 * {@link GHANA_CAMPAIGN} into one line per origin, weighted by that origin's
 * count, and `renderRegion` picking a single country out of the base map.
 */
export function TargetedDemo(): JSX.Element {
  const attacks = useMemo(() => makeCampaignAttacks(GHANA_CAMPAIGN, TARGET), []);
  const total = GHANA_CAMPAIGN.reduce((sum, origin) => sum + origin.count, 0);

  return (
    <Panel
      title="One target under fire"
      description={`${total} attacks from five countries, all aimed at Ghana. Each origin collapses to one line, weighted by its attack count — so Russia's 48 read heavier than Vietnam's 4. The target itself is highlighted through the renderRegion hook.`}
      code={`<ThreatMap
  attacks={attacks}                        // ${total} attacks, every one { to: '${TARGET}' }
  renderRegion={(ctx, { feature, id, path }) => {
    if (id !== 'GH') return false;         // built-in renderer handles the rest
    ctx.save();
    ctx.beginPath();
    path(feature);
    ctx.shadowColor = '#f97316';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#f97316';
    ctx.fill();
    ctx.restore();
    return true;                           // we drew it
  }}
/>`}
    >
      <div style={{ position: 'relative' }}>
        <ThreatMap attacks={attacks} renderRegion={highlightTarget} theme={CAMPAIGN_THEME} line={{ curvature: 0.28 }} />
        <ul className="legend">
          {GHANA_CAMPAIGN.map((origin) => (
            <li key={origin.region}>
              {/*
                The same colours the map was handed. Each origin's attacks all
                share one severity, so the aggregate's severity — the max across
                its members — is that severity, and the swatch matches the line.
              */}
              <span className="legend-dot" style={{ background: CAMPAIGN_THEME.severityColors?.[origin.severity] }} />
              {origin.name}
              <span className="legend-count">{origin.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/* ------------------------- 7. domestic (one country) ----------------------- */

/**
 * A US-only projection, built once.
 *
 * `geoAlbersUsa` is the reason this demo can zoom without any new library API:
 * it is defined only over American territory, so the fit-to-sphere pass inside
 * `createProjection` ends up framing the United States rather than the globe.
 *
 * Two consequences, both visible above:
 *
 * - **Distant geography disappears, nearby geography does not.** The projection
 *   returns `null` for Mexico City, London, and Beijing, but southern Canada
 *   falls inside the lower-48 cone's clip rectangle and projects normally — so
 *   the Maritimes and Ontario still draw. The result is the US in context rather
 *   than a hard cutout, which suits a domestic view fine, but it is worth knowing
 *   it is not a US-only stencil.
 * - **Any arc touching an unprojectable endpoint is dropped.** `buildArc` returns
 *   `null` when either endpoint fails to project, so a `CN → US-CA` attack simply
 *   would not render here. That is correct for a deliberately domestic feed, and
 *   a trap if you point this projection at a mixed one.
 *
 * Hoisted to module scope because `projection` is a dependency of the base map's
 * redraw effect — a fresh instance per render would re-rasterize every outline
 * on every render. (`ThreatMap` compares config props by value, but a projection
 * is an opaque function, so identity is all it has to go on.)
 */
const US_PROJECTION = geoAlbersUsa() as unknown as GeoProjectionLike;

/**
 * A box around Germany, with enough padding to keep its neighbours in frame.
 *
 * Given as the box's two opposite corners rather than as a `Polygon` ring, and
 * that is not a stylistic choice. d3-geo interprets polygons **spherically**, so
 * a ring's winding order decides which side of it is the inside. Wind the four
 * corners the wrong way and `fitExtent` dutifully fits the entire globe *minus*
 * Germany — no error, no warning, just a map zoomed the wrong way by a factor of
 * twenty. A `MultiPoint` has no interior to get backwards; its bounds are simply
 * its points.
 */
const GERMANY_EXTENT = {
  type: 'MultiPoint',
  coordinates: [
    [4.5, 46.5],
    [16.5, 56.0],
  ],
};

/**
 * A projection framed on Germany.
 *
 * Germany needs more work than the US because there is no `geoAlbersDeutschland`
 * to lean on — a plain `geoMercator` is defined over the whole world, so passing
 * one in gets it fitted to the globe like any other and the zoom is thrown away.
 *
 * Pre-scaling it at module scope does not work either: the library fits the
 * projection to the *measured* viewport, which module scope cannot know, so a
 * hard-coded `translate` would be wrong at every size but one.
 *
 * The way through is to keep `fitExtent` — so viewport sizing still works — and
 * ignore the object the library asks us to fit. It passes `{type: 'Sphere'}`;
 * we fit {@link GERMANY_EXTENT} to the same pixel box instead. The result scales
 * correctly with the container and lands on Germany.
 *
 * The override goes on an instance we exclusively own rather than on a wrapper
 * function. Wrapping looks tidier and is a trap: `geoPath` draws outlines through
 * `projection.stream`, not by calling the projection, so a plain function that
 * only forwards point projection throws on the first country it tries to draw.
 * Overriding one method leaves the rest of d3's surface — `stream`, `invert`,
 * `clipExtent` — untouched.
 */
const GERMANY_PROJECTION: GeoProjectionLike = (() => {
  const projection = geoMercator();
  const fitExtent = projection.fitExtent.bind(projection);

  projection.fitExtent = (extent) => {
    fitExtent(extent, GERMANY_EXTENT as never);
    return projection;
  };

  return projection as unknown as GeoProjectionLike;
})();

/** The three ways to frame a domestic feed. */
type DomesticScale = 'de' | 'us' | 'world';

const SCALE_LABELS: Record<DomesticScale, string> = {
  de: 'Germany',
  us: 'United States',
  world: 'World',
};

const PROJECTIONS: Record<DomesticScale, GeoProjectionLike | 'naturalEarth1'> = {
  de: GERMANY_PROJECTION,
  us: US_PROJECTION,
  world: 'naturalEarth1',
};

const DESCRIPTIONS: Record<DomesticScale, (total: number) => React.ReactNode> = {
  de: () => (
    <>
      Three attacks that start and end in the same city — Frankfurt to Frankfurt. Germany has no subdivisions in this
      library, so there is no second anchor to travel to and the chord is exactly zero. Rather than drop to an
      invisible point, the arc becomes a self-loop tangent to the city: the origin marker sits on Frankfurt, the head
      runs the loop, and the impact ripple fires back on the same spot. Framed by handing the library a mercator whose
      fitExtent ignores the sphere and fits a box around Germany instead.
    </>
  ),
  us: () => (
    <>
      92 attacks between US states, aggregated into one arc per state pair, so the map reads as lateral movement rather
      than an inbound campaign. Framed by passing geoAlbersUsa — no new props needed, since fitting a US-only
      projection frames the US. Anything it cannot project drops out, which includes the Frankfurt flow; nearby Canada
      still draws. California → California is the same self-loop case as Frankfurt, reached from the other direction.
    </>
  ),
  world: (total) => (
    <>
      All {total} attacks at world scale, German and American together. The arcs are still correct, just short:
      California → New York spans ~110 px against ~530 px for China → California. The Frankfurt self-loop holds its
      size here — the loop radius is clamped in pixels rather than scaled from a chord, which is what keeps a
      same-city attack visible on a world map instead of shrinking to nothing.
    </>
  ),
};

const CODE_SAMPLES: Record<DomesticScale, string> = {
  de: `import { geoMercator } from 'd3-geo';

// Two opposite corners, not a Polygon ring: d3-geo reads polygons spherically,
// so the wrong winding order silently fits the globe minus Germany.
const GERMANY_EXTENT = {
  type: 'MultiPoint',
  coordinates: [[4.5, 46.5], [16.5, 56.0]],
};

// Both ends are the same coordinate, so the arc is drawn as a self-loop.
const attacks = [
  { id: 'de-0', from: FRANKFURT, to: FRANKFURT, severity: 'critical' },
  { id: 'de-1', from: FRANKFURT, to: FRANKFURT, severity: 'critical' },
  { id: 'de-2', from: FRANKFURT, to: FRANKFURT, severity: 'critical' },
];

// Keep fitExtent so the library still sizes to the viewport, but fit a box
// around Germany rather than the {type: 'Sphere'} it asks for. Override the
// method rather than wrapping — geoPath draws through projection.stream.
const projection = geoMercator();
const fitExtent = projection.fitExtent.bind(projection);
projection.fitExtent = (extent) => {
  fitExtent(extent, GERMANY_EXTENT);
  return projection;
};

<ThreatMap attacks={attacks} projection={projection} />`,
  us: `import { geoAlbersUsa } from 'd3-geo';

// Defined over US territory, so fitting frames the country, not the globe.
// Endpoints it cannot project are dropped — keep the feed domestic.
const projection = geoAlbersUsa();

<ThreatMap
  attacks={attacks}                        // every from/to is a 'US-XX' code
  projection={projection}
  regions={{ showStates: true, showSphere: false }}
/>`,
  world: `<ThreatMap
  attacks={attacks}                        // German and US flows together
  regions={{ showStates: true }}
/>`,
};

/**
 * Attacks whose origin *and* destination sit inside the same country.
 *
 * Worth its own demo because "one country at both ends" is not one behaviour but
 * three, and the difference is entirely about how far apart the two endpoints
 * resolve:
 *
 * 1. **Different subdivisions, world view.** `US-CA → US-NY` is a normal arc —
 *    it just spans ~110 px instead of ~530 px. Nothing special happens; it is
 *    only small. For a physically smaller country it is smaller still: Berlin to
 *    Munich is ~13 px at world scale, which is why the country view exists.
 * 2. **Different subdivisions, country view.** Swap in a projection that frames
 *    one country and the same feed becomes the whole map. This needs no new
 *    props — see {@link US_PROJECTION}.
 * 3. **Identical endpoints.** The awkward one. `Frankfurt → Frankfurt` and
 *    `US-CA → US-CA` both collapse to a single point: there is no chord, so
 *    there is no direction to travel and nothing for a line to span. `buildArc`
 *    answers this with a self-loop anchored on the point — see `buildSelfLoop`
 *    in `src/render/path.ts`. Germany is the honest version of the case, because
 *    it has no subdivisions here: `'DE' → 'DE'` has nowhere else to land, so a
 *    self-directed flow is the *only* way to express a domestic German attack.
 */
export function DomesticDemo(): JSX.Element {
  const [scale, setScale] = useState<DomesticScale>('de');
  // One feed for all three views. Only the projection changes, so the world view
  // shows the German and American flows side by side.
  const attacks = useMemo(() => makeDomesticAttacks(DOMESTIC_FLOWS), []);
  const total = DOMESTIC_FLOWS.reduce((sum, flow) => sum + flow.count, 0);

  const isCountry = scale === 'us';

  return (
    <Panel
      title="Domestic attacks — one country at both ends"
      description={DESCRIPTIONS[scale](total)}
      code={CODE_SAMPLES[scale]}
      actions={
        <div className="segmented">
          {(['de', 'us', 'world'] as const).map((option) => (
            <button
              key={option}
              className={`btn ${scale === option ? 'btn-active' : ''}`}
              onClick={() => setScale(option)}
            >
              {SCALE_LABELS[option]}
            </button>
          ))}
        </div>
      }
    >
      <div style={{ position: 'relative' }}>
        <ThreatMap
          attacks={attacks}
          projection={PROJECTIONS[scale]}
          // `showSphere` fills the projected globe and leaves everything outside
          // it transparent — right for a world projection, wrong for a zoomed
          // one, where the sphere is either undefined (albersUsa) or far larger
          // than the viewport (a fitted mercator). Falling back to a flat rect
          // fill is what keeps a country view from rendering its ocean as a
          // stray blob.
          regions={{ showStates: true, showSphere: scale === 'world' }}
          theme={CAMPAIGN_THEME}
          line={{ curvature: 0.24 }}
        />
        <ul className="legend">
          {DOMESTIC_FLOWS.map((flow) => {
            // A view that cannot draw a flow should not claim it. albersUsa
            // drops Frankfurt outright, and the German frame leaves the US
            // arcs far off-canvas — either way the legend would be lying.
            const drawn = scale === 'world' || flow.scope === scale;
            return (
              <li key={flow.id} style={{ opacity: drawn ? 1 : 0.35 }}>
                <span className="legend-dot" style={{ background: CAMPAIGN_THEME.severityColors?.[flow.severity] }} />
                {flow.label}
                <span className="legend-count">{flow.count}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}

/* --------------------------------- layout ---------------------------------- */

interface PanelProps {
  readonly title: string;
  readonly description: React.ReactNode;
  readonly code: string;
  readonly actions?: React.ReactNode;
  readonly children: React.ReactNode;
}

function Panel({ title, description, code, actions, children }: PanelProps): JSX.Element {
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {actions}
      </header>
      <div className="map-frame">{children}</div>
      <pre className="code">{code}</pre>
    </section>
  );
}
