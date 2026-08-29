// Re-exports of canonical upstream types consumed by the generator.
// Centralized so the generator depends on one stable import surface.

export type { TestCase } from 'test-planner';
export type { ExecutionMappingIR } from 'execution-mapping-builder';
export type { ProjectExecutionProfile } from 'project-adapter';

export type {
  UIElementCatalog,
  UIElementLocator,
  UIElementDefinition,
  UIPageDefinition,
  UIActionType,
  UIAssertionType,
  UILocatorStrategy,
  TestExecutionMapping,
  UIStepMapping,
  UIAssertionMapping,
} from 'ui-executor';

export type {
  TestRunResultIR,
  TestExecutionResultIR,
  TestRunSummary,
  TestResultStatus,
  AssertionResult,
  TestExecutionError,
  TestProvenance,
} from 'test-execution-orchestrator';
