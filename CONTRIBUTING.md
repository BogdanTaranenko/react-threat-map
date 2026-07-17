# Contributing

Thanks for taking an interest. Issues and PRs are welcome.

## Getting set up

```bash
git clone https://github.com/BogdanTaranenko/react-threat-map
cd react-threat-map
npm install
npm run build      # regenerates geo data, then builds the library
```

Run the demo — the fastest way to see a change:

```bash
cd examples/demo
npm install
npm run dev
```

The demo imports the library from `src/` via a Vite alias, so edits hot-reload with no
rebuild.

## The checks

```bash
npm test           # 228 unit tests
npm run typecheck  # includes the type-contract suite — see below
npm run build
```

All three run in CI on Node 18, 20, and 22. `npm run typecheck` is **not** redundant with
`npm test`: `tests/types.test-d.tsx` asserts the shape of the public API, including
`@ts-expect-error` cases that verify misuse *fails* to compile. Only `tsc` can check that;
no runtime test can.

## Repo layout

| Path | What lives there |
| --- | --- |
| `src/types.ts` | The entire public API surface. Start here. |
| `src/aggregation/` | Pure grouping logic. No React, no canvas, no async. |
| `src/geo/` | Region resolution, reverse lookup, geo loading. |
| `src/render/` | Projection, arc geometry, the two canvas renderers. |
| `src/hooks/`, `src/components/` | The React layer. |
| `scripts/build-geo.mjs` | Generates `src/geo/data/*.json` from Natural Earth. |

## Two things that will bite you

**The geo data is generated *and* committed.** `src/geo/data/*.json` is produced by
`scripts/build-geo.mjs` but checked in, so tests and consumers don't need ~4 MB of Natural
Earth devDependencies. If you change the script, run `npm run geo` and commit the result —
CI fails if the two disagree. Don't hand-edit the JSON.

**Resolving and drawing deliberately use different datasets.** Boundaries are drawn at
1:110m; region resolution uses 1:10m plus a small-country file. This is not an oversight —
1:110m omits Singapore, Hong Kong, and ~60 other countries, and deriving resolution from it
silently attributed their attacks to the wrong country. See
[DECISIONS.md](./DECISIONS.md#3-geo-data-natural-earth-lazily-loaded-with-an-inline-centroid-table)
before changing anything in that area.

## Performance

The threat layer's cost is bounded by the number of distinct *styles*, not the number of
threats — that is the entire reason Canvas 2D is viable here instead of WebGL. Two tests in
`tests/render/drawThreats.test.ts` assert draw calls plateau as threat count grows.

If you touch `src/render/drawThreats.ts`, keep the batching intact: geometry is precomputed
once per layout, and anything that issues a draw call per threat defeats the design. The
heavy-load demo has a live FPS counter for checking real behaviour.

## Style

- Match the surrounding code. Comments explain *why*, not *what*.
- Every public export needs TSDoc — it is the API reference IDEs show.
- Strict TypeScript, no `any` in public types.
- New behaviour needs a test. Bug fixes need a test that fails without the fix.

## Releasing

Maintainers only:

```bash
npm version patch|minor|major
git push --follow-tags
```

Then publish a GitHub Release for the tag; CI publishes to npm with provenance. This needs
an `NPM_TOKEN` repo secret.
