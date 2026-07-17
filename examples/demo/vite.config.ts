import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/, not the domain root, so the
  // Pages workflow sets DEMO_BASE=/react-threat-map/. Everywhere else — dev server,
  // `vite preview`, the CI build check — the default root base is what's wanted.
  base: process.env.DEMO_BASE ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      // Point at source, so editing the library hot-reloads the demo without a
      // rebuild. A real consumer would just import 'react-threat-map'.
      'react-threat-map': resolve(__dirname, '../../src/index.ts'),
    },
  },
});
