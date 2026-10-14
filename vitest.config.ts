import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The tests of a package run against the sources of the packages it uses, as its types check
    // against them (the paths of tsconfig.json): no build between a change and the tests.
    alias: {
      'ejs-template-parser': fileURLToPath(new URL('./packages/ejs-template-parser/src/index.ts', import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      reporter: ['text', 'html', 'lcov'],
      // Just under what the tests cover: `npm run coverage` fails when a change lowers it.
      thresholds: { statements: 97, branches: 94, functions: 99, lines: 97 },
    },
  },
});
