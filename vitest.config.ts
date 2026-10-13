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
});
