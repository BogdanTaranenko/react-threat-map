import { defineConfig } from 'tsup';

export default defineConfig({
  // Two entries: the component surface, and the geo data loader.
  //
  // `geo` is split out so a consumer who only wants the aggregation utilities
  // never pulls boundary geometry into their bundle. Within `index`, the geo
  // module is reached through a dynamic `import()`, which tsup emits as its own
  // chunk — so the ~120 kB of TopoJSON is fetched on mount, not on page load.
  entry: {
    index: 'src/index.ts',
    geo: 'src/geo/index.ts',
  },
  format: ['esm', 'cjs'],
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  dts: true,
  splitting: true,
  // Deliberately off. The output is unminified and reads closely enough to the
  // source that maps add little — while costing ~2.5 MB of the published
  // package, 800 kB of which would be sourcemaps for the generated TopoJSON
  // chunks, mapping a data file onto itself. Anyone debugging the library itself
  // is running it from source, where maps come from tsconfig.
  sourcemap: false,
  clean: true,
  treeshake: true,
  target: 'es2020',
  // React is a peer dep; d3-geo/topojson-client stay external so consumers
  // dedupe them against their own copies rather than shipping two.
  external: ['react', 'react-dom', 'd3-geo', 'topojson-client'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
