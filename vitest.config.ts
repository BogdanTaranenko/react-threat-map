import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.d.ts',
        'src/geo/data/**',
        // Barrel and declaration-only modules emit no runtime code, so their
        // "0% covered" is an artifact rather than a gap. types.ts is verified by
        // tests/types.test-d.tsx, which tsc checks — the only thing that can
        // check a type.
        'src/index.ts',
        'src/types.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
