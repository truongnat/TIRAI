// ---------------------------------------------------------------------------
// Database Executor – validation barrel export
// ---------------------------------------------------------------------------

export { validateDatabaseOperation } from './operation-validator.js';
export { rejectDDL, rejectRawSql, validateMutationGate, validateWhereClause } from './mutation-safety.js';
