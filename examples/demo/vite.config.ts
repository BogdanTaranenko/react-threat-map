import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Point at source, so editing the library hot-reloads the demo without a
      // rebuild. A real consumer would just import 'react-threat-map'.
      'react-threat-map': resolve(__dirname, '../../src/index.ts'),
    },
  },
});
