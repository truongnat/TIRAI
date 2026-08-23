// ---------------------------------------------------------------------------
// Database Executor – compiler barrel export
// ---------------------------------------------------------------------------

export { compileDatabaseCommand } from './postgres-compiler.js';
export type { CompilerOptions } from './postgres-compiler.js';
export { validateIdentifier, quoteIdentifier, buildAllowedSet } from './identifier.js';
export { resolveValueExpression } from './binding-resolver.js';
