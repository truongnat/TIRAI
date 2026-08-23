// ---------------------------------------------------------------------------
// Database Executor – driver barrel export
// ---------------------------------------------------------------------------

export { PostgreSQLDriver } from './postgres-driver.js';
export { createDriver, resolveSecrets } from './driver.js';
export type { DatabaseDriver, DatabaseSession, DatabaseDialect } from './driver.js';
