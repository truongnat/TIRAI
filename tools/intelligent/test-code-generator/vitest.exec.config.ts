import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkgRoot = fileURLToPath(new URL('.', import.meta.url));

// Dedicated config used ONLY by the spawned Vitest run inside the unit
// execution bridge. It must be able to pick up the generated
// `output/**/*.spec.ts` files (which the root config excludes for the package
// test run). `root` is pinned to the package directory so module resolution of
// the generated relative imports works deterministically.
export default defineConfig({
  test: {
    root: pkgRoot,
    include: ['**/*.spec.ts'],
    // Keep the spawned run scoped to Phase 5.2 generated specs only; never pull
    // in the Phase 5.1 Playwright specs (which live under output/phase-5-1*).
    exclude: ['**/phase-5-1*/**', 'node_modules', 'dist', 'fixtures', 'coverage'],
  },
});
