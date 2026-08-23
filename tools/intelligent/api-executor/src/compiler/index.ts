// API Executor v1 — Compiler barrel export.

export { compileApiRequest, isMutatingMethod, isIdempotentMethod } from './request-compiler.js';
export type { CompileOptions } from './request-compiler.js';
export {
  validateProtocol,
  validateHttpAllowed,
  validateHost,
  validateOrigin,
  validatePath,
  validateFullUrl,
  buildSafeUrl,
  isPrivateHost,
  isMetadataIp,
} from './url-safety.js';
export { resolveValueExpression, resolveRecordExpressions, resolveBodyDeep } from './binding-resolver.js';
