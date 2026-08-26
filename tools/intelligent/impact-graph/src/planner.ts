// ---------------------------------------------------------------------------
// Incremental Planner — Selective planning based on impact analysis
// ---------------------------------------------------------------------------
// Uses the impact graph to determine which requirements need replanning
// and which can be preserved.

import type { SemanticIR } from 'semantic-analyzer';
import type { Requirement } from 'requirement-builder';
import type {
  ImpactGraph,
  IncrementalPlanningRequest,
  IncrementalPlanningPlan,
  RequirementImpact,
} from './models.js';
import { ImpactEngine } from './engine.js';
import { generateImpactNodeId } from './builder.js';

// ---- Incremental Planner --------------------------------------------------

export class IncrementalPlanner {
  private readonly impactEngine: ImpactEngine;

  constructor() {
    this.impactEngine = new ImpactEngine();
  }

  /**
   * Create an incremental planning plan from two revisions.
   */
  createPlan(request: IncrementalPlanningRequest): IncrementalPlanningPlan {
    // Compute impact graph
    const impactGraph = this.impactEngine.computeImpact(
      request.baseRevision.id,
      request.targetRevision.id,
      request.baseRevision.fingerprint,
      request.targetRevision.fingerprint,
      request.baseRevision.semanticIR,
      request.targetRevision.semanticIR,
      request.baseRevision.requirements,
      request.targetRevision.requirements,
    );

    // Categorize requirements
    const requirementsToPlan: Requirement[] = [];
    const requirementsToPreserve: Requirement[] = [];
    const requirementsToRemove: Requirement[] = [];
    const requirementsUnknown: Requirement[] = [];

    // Check target requirements
    for (const req of request.targetRevision.requirements) {
      const nodeId = generateImpactNodeId('requirement', req.id);
      const impact = impactGraph.requirementImpacts.get(nodeId);

      if (!impact) {
        // No impact information, treat as unknown
        requirementsUnknown.push(req);
        continue;
      }

      switch (impact.impactLevel) {
        case 'added':
        case 'direct':
        case 'transitive':
          requirementsToPlan.push(req);
          break;
        case 'unchanged':
          requirementsToPreserve.push(req);
          break;
        case 'unknown':
          requirementsUnknown.push(req);
          break;
        default:
          requirementsUnknown.push(req);
      }
    }

    // Check for removed requirements
    for (const req of request.baseRevision.requirements) {
      if (!request.targetRevision.requirements.some((r) => r.id === req.id)) {
        requirementsToRemove.push(req);
      }
    }

    // Determine if full replan is required
    const fullReplanRequired = requirementsUnknown.length > 0;
    const fullReplanReason = fullReplanRequired
      ? `Unknown impact for ${requirementsUnknown.length} requirements`
      : undefined;

    return {
      requirementsToPlan,
      requirementsToPreserve,
      requirementsToRemove,
      requirementsUnknown,
      impactGraph,
      fullReplanRequired,
      fullReplanReason,
    };
  }

  /**
   * Create a subset RequirementIRInput for planning.
   */
  createSubsetRequirementIR(
    fullRequirementIR: unknown,
    requirementsToPlan: Requirement[],
    requirementsToPreserve: Requirement[],
  ): unknown {
    const ir = fullRequirementIR as {
      schemaVersion: string;
      document: unknown;
      requirements: unknown[];
    };

    return {
      schemaVersion: ir.schemaVersion,
      document: ir.document,
      requirements: [...requirementsToPlan, ...requirementsToPreserve].map(
        (req) => ({
          id: req.id,
          title: req.title,
          type: req.type,
          statement: req.statement,
          sourceNature: req.sourceNature,
          actor: req.actor,
          trigger: req.trigger,
          preconditions: req.preconditions,
          inputs: req.inputs,
          dataNeeds: req.dataNeeds,
          expectedBehaviors: req.expectedBehaviors,
          outcomes: req.outcomes,
          constraints: req.constraints,
          relatedSemanticIds: req.relatedSemanticIds,
          provenance: req.provenance,
          confidence: req.confidence,
          testability: req.testability,
          contentHash: req.contentHash,
        }),
      ),
    };
  }

  /**
   * Merge planning results with preserved artifacts.
   */
  mergePlanningResults(
    previousPlan: unknown,
    newPlan: unknown,
    impactGraph: ImpactGraph,
    requirementsToPreserve: Requirement[],
    requirementsToRemove: Requirement[],
  ): unknown {
    const prev = previousPlan as {
      scenarios: unknown[];
      testCases: unknown[];
      dataNeeds: unknown[];
    };

    const newP = newPlan as {
      scenarios: unknown[];
      testCases: unknown[];
      dataNeeds: unknown[];
    };

    // Identify preserved scenarios and test cases
    const preservedScenarioIds = new Set<string>();
    const preservedTestCaseIds = new Set<string>();

    for (const req of requirementsToPreserve) {
      const reqNodeId = generateImpactNodeId('requirement', req.id);
      const impact = impactGraph.requirementImpacts.get(reqNodeId);

      if (impact && impact.impactLevel === 'unchanged') {
        // Find scenarios for this requirement
        for (const scenario of prev.scenarios) {
          const s = scenario as { requirementIds?: string[]; id?: string };
          if (s.requirementIds?.includes(req.id) && s.id) {
            preservedScenarioIds.add(s.id);
          }
        }

        // Find test cases for this requirement's scenarios
        for (const testCase of prev.testCases) {
          const tc = testCase as { scenarioId?: string; id?: string };
          if (tc.scenarioId && preservedScenarioIds.has(tc.scenarioId) && tc.id) {
            preservedTestCaseIds.add(tc.id);
          }
        }
      }
    }

    // Merge scenarios
    const mergedScenarios = [
      ...prev.scenarios.filter((s) => {
        const scenario = s as { id?: string };
        return scenario.id && preservedScenarioIds.has(scenario.id);
      }),
      ...newP.scenarios,
    ];

    // Merge test cases
    const mergedTestCases = [
      ...prev.testCases.filter((tc) => {
        const testCase = tc as { id?: string };
        return testCase.id && preservedTestCaseIds.has(testCase.id);
      }),
      ...newP.testCases,
    ];

    // Merge data needs
    const mergedDataNeeds = [
      ...prev.dataNeeds.filter((dn) => {
        const dataNeed = dn as { scenarioId?: string };
        return dataNeed.scenarioId && preservedScenarioIds.has(dataNeed.scenarioId);
      }),
      ...newP.dataNeeds,
    ];

    return {
      scenarios: mergedScenarios,
      testCases: mergedTestCases,
      dataNeeds: mergedDataNeeds,
    };
  }

  /**
   * Validate coverage after merge.
   */
  validateCoverage(
    mergedPlan: unknown,
    requirements: Requirement[],
  ): { passed: boolean; missingRequirements: string[] } {
    const plan = mergedPlan as { scenarios: unknown[] };
    const missingRequirements: string[] = [];

    for (const req of requirements) {
      const hasCoverage = plan.scenarios.some((s) => {
        const scenario = s as { requirementIds?: string[] };
        return scenario.requirementIds?.includes(req.id);
      });

      if (!hasCoverage) {
        missingRequirements.push(req.id);
      }
    }

    return {
      passed: missingRequirements.length === 0,
      missingRequirements,
    };
  }
}
