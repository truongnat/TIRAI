// ---------------------------------------------------------------------------
// Database Executor – driver contract
// ---------------------------------------------------------------------------
// Abstract driver interface.  PostgreSQL is the first implementation.
// The domain layer never leaks driver-specific types.

import type {
  DatabaseDialect,
  DatabaseConnectionConfig,
  ResolvedSecrets,
  DatabaseSession,
  DatabaseDriver,
} from '../models.js';

export type { DatabaseDriver, DatabaseSession, DatabaseDialect };

/**
 * Create a database driver for the given dialect.
 */
export function createDriver(dialect: DatabaseDialect): DatabaseDriver {
  switch (dialect) {
    case 'postgresql':
      // Lazy import to avoid loading pg when not needed
      return createPostgreSQLDriver();
    default:
      throw new Error(`Unsupported database dialect: ${dialect}`);
  }
}

/**
 * Placeholder — the real PostgreSQL driver is in postgres-driver.ts.
 * This function exists so the factory can reference it without circular imports.
 */
function createPostgreSQLDriver(): DatabaseDriver {
  // Will be replaced by actual import in index.ts
  throw new Error('PostgreSQL driver not initialized — import from driver/postgres-driver.js');
}

/**
 * Resolve connection secrets from the secret provider.
 */
export async function resolveSecrets(
  config: DatabaseConnectionConfig,
  secretProvider?: { resolve(ref: string): Promise<{ value: string }> },
): Promise<ResolvedSecrets> {
  const secrets: ResolvedSecrets = {};

  if (config.connectionStringSecretRef && secretProvider) {
    const resolved = await secretProvider.resolve(config.connectionStringSecretRef);
    secrets.connectionString = resolved.value;
  }

  if (config.userSecretRef && secretProvider) {
    const resolved = await secretProvider.resolve(config.userSecretRef);
    secrets.user = resolved.value;
  }

  if (config.passwordSecretRef && secretProvider) {
    const resolved = await secretProvider.resolve(config.passwordSecretRef);
    secrets.password = resolved.value;
  }

  return secrets;
}
