// ---------------------------------------------------------------------------
// Global setup – creates all test fixtures once before any test runs.
// ---------------------------------------------------------------------------

import { createAllFixtures } from './fixtures.js';

export default async function setup(): Promise<void> {
  await createAllFixtures();
}
