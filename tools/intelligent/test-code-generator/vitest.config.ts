import { defineConfig } from 'vitest/config';

// Root config for THIS package's own test suite (Phase 5.1/5.2 acceptance +
// unit tests). It deliberately excludes the generated artifacts under
// `output/` and `fixtures/`, so `npm test` never tries to run generated
// Playwright/Vitest specs (which require their own runners).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'output', 'fixtures', 'coverage'],
  },
});
