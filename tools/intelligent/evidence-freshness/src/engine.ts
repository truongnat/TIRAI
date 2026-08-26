// ---------------------------------------------------------------------------
// Freshness Engine — Computes freshness matches for evidence reuse
// ---------------------------------------------------------------------------
// Evaluates freshness dimensions and determines safe reuse.

import type {
  EvidenceValidityContext,
  ApplicationIdentity,
  EnvironmentIdentity,
  RuntimeDataIdentity,
  VerificationPolicyIdentity,
  CapabilitySet,
  FreshnessDimension,
  FreshnessMatch,
  TestCaseExecutionDecision,
  ExecutionDecision,
  ExecutionReason,
  SelectiveExecutionPlan,
  ExecutionPlanSummary,
} from './models.js';

// ---- Freshness Engine -----------------------------------------------------

export class FreshnessEngine {
  private readonly reusePolicyVersion = '1.0';

  /**
   * Evaluate freshness for a TestCase.
   */
  evaluateTestCase(
    testCaseId: string,
    previousContext: EvidenceValidityContext | undefined,
    currentContext: Partial<EvidenceValidityContext>,
  ): TestCaseExecutionDecision {
    // If no previous context, must retest
    if (!previousContext) {
      return {
        testCaseId,
        decision: 'retest',
        reasons: ['new-testcase'],
        freshnessMatches: this.createDefaultMatches(),
      };
    }

    // Evaluate each freshness dimension
    const freshnessMatches: Record<FreshnessDimension, FreshnessMatch> = {
      spec: this.evaluateSpecFreshness(previousContext, currentContext),
      requirement: this.evaluateRequirementFreshness(previousContext, currentContext),
      testcase: this.evaluateTestCaseFreshness(previousContext, currentContext),
      'expected-result': this.evaluateExpectedResultFreshness(previousContext, currentContext),
      application: this.evaluateApplicationFreshness(previousContext, currentContext),
      environment: this.evaluateEnvironmentFreshness(previousContext, currentContext),
      data: this.evaluateDataFreshness(previousContext, currentContext),
      'verification-policy': this.evaluateVerificationPolicyFreshness(previousContext, currentContext),
      capability: this.evaluateCapabilityFreshness(previousContext, currentContext),
      time: this.evaluateTimeFreshness(previousContext, currentContext),
    };

    // Determine decision and reasons
    const { decision, reasons } = this.determineDecision(freshnessMatches);

    return {
      testCaseId,
      decision,
      reasons,
      freshnessMatches,
      previousEvidenceId: previousContext.evidenceId,
      previousRunId: previousContext.evidenceId, // Simplified
      previousExecutionAt: previousContext.acquiredAt,
    };
  }

  /**
   * Create selective execution plan.
   */
  createExecutionPlan(
    decisions: TestCaseExecutionDecision[],
    baseSpecRevision?: string,
    targetSpecRevision?: string,
    baseApplication?: ApplicationIdentity,
    targetApplication?: ApplicationIdentity,
    baseEnvironment?: EnvironmentIdentity,
    targetEnvironment?: EnvironmentIdentity,
  ): SelectiveExecutionPlan {
    const toExecute: TestCaseExecutionDecision[] = [];
    const toReuse: TestCaseExecutionDecision[] = [];
    const invalidated: TestCaseExecutionDecision[] = [];
    const removed: TestCaseExecutionDecision[] = [];
    const unknownRetest: TestCaseExecutionDecision[] = [];

    for (const decision of decisions) {
      switch (decision.decision) {
        case 'retest':
          toExecute.push(decision);
          break;
        case 'safe-reuse':
          toReuse.push(decision);
          break;
        case 'invalidated':
          invalidated.push(decision);
          break;
        case 'removed':
          removed.push(decision);
          break;
        case 'unknown-retest':
          unknownRetest.push(decision);
          break;
      }
    }

    const summary: ExecutionPlanSummary = {
      testCasesTotal: decisions.length,
      testCasesExecuted: toExecute.length + unknownRetest.length,
      testCasesReused: toReuse.length,
      testCasesInvalidated: invalidated.length,
      testCasesRemoved: removed.length,
      unknownRetests: unknownRetest.length,
      browserLaunchesAvoided: toReuse.length,
      journeyCallsAvoided: toReuse.length,
    };

    return {
      schemaVersion: '1.0',
      baseSpecRevision,
      targetSpecRevision,
      baseApplication,
      targetApplication,
      baseEnvironment,
      targetEnvironment,
      toExecute,
      toReuse,
      invalidated,
      removed,
      unknownRetest,
      summary,
    };
  }

  // ---- Freshness Evaluation Helpers ---------------------------------------

  private evaluateSpecFreshness(
    previous: EvidenceValidityContext,
    current: Partial<EvidenceValidityContext>,
  ): FreshnessMatch {
    if (!previous.sourceRevisionFingerprint || !current.sourceRevisionFingerprint) {
      return 'unknown';
    }
    return previous.sourceRevisionFingerprint === current.sourceRevisionFingerprint
      ? 'match'
      : 'mismatch';
  }

  private evaluateRequirementFreshness(
    previous: EvidenceValidityContext,
    current: Partial<EvidenceValidityContext>,
  ): FreshnessMatch {
    if (!previous.requirementContentHash || !current.requirementContentHash) {
      return 'unknown';
    }
    return previous.requirementContentHash === current.requirementContentHash
      ? 'match'
      : 'mismatch';
  }

  private evaluateTestCaseFreshness(
    previous: EvidenceValidityContext,
    current: Partial<EvidenceValidityContext>,
  ): FreshnessMatch {
    if (!previous.testCaseContentHash || !current.testCaseContentHash) {
      return 'unknown';
    }
    return previous.testCaseContentHash === current.testCaseContentHash
      ? 'match'
      : 'mismatch';
  }

  private evaluateExpectedResultFreshness(
    previous: EvidenceValidityContext,
    current: Partial<EvidenceValidityContext>,
  ): FreshnessMatch {
    if (!previous.expectedResultContentHash || !current.expectedResultContentHash) {
      return 'unknown';
    }
    return previous.expectedResultContentHash === current.expectedResultContentHash
      ? 'match'
      : 'mismatch';
  }

  private evaluateApplicationFreshness(
    previous: EvidenceValidityContext,
    current: Partial<EvidenceValidityContext>,
  ): FreshnessMatch {
    if (!previous.application || !current.application) {
      return 'unknown';
    }

    // Compare fingerprints if available
    if (previous.application.fingerprint && current.application.fingerprint) {
      return previous.application.fingerprint === current.application.fingerprint
        ? 'match'
        : 'mismatch';
    }

    // Compare build IDs if available
    if (previous.application.buildId && current.application.buildId) {
      return previous.application.buildId === current.application.buildId
        ? 'match'
        : 'mismatch';
    }

    // Compare project versions if available
    if (previous.application.projectVersion && current.application.projectVersion) {
      return previous.application.projectVersion === current.application.projectVersion
        ? 'match'
        : 'mismatch';
    }

    return 'unknown';
  }

  private evaluateEnvironmentFreshness(
    previous: EvidenceValidityContext,
    current: Partial<EvidenceValidityContext>,
  ): FreshnessMatch {
    if (!previous.environment || !current.environment) {
      return 'unknown';
    }

    // Compare environment IDs
    if (previous.environment.environmentId !== current.environment.environmentId) {
      return 'mismatch';
    }

    // Compare fingerprints if available
    if (previous.environment.fingerprint && current.environment.fingerprint) {
      return previous.environment.fingerprint === current.environment.fingerprint
        ? 'match'
        : 'mismatch';
    }

    // Compare base URLs if available
    if (previous.environment.baseUrl && current.environment.baseUrl) {
      return previous.environment.baseUrl === current.environment.baseUrl
        ? 'match'
        : 'mismatch';
    }

    return 'match';
  }

  private evaluateDataFreshness(
    previous: EvidenceValidityContext,
    current: Partial<EvidenceValidityContext>,
  ): FreshnessMatch {
    // If no data dependency, not applicable
    if (!previous.data && !current.data) {
      return 'not-applicable';
    }

    // If data is time-sensitive, must retest
    if (previous.data?.timeSensitive || current.data?.timeSensitive) {
      return 'mismatch';
    }

    // If data identity is unknown, must retest
    if (!previous.data || !current.data) {
      return 'unknown';
    }

    // Compare entity versions if available
    if (previous.data.entityVersion && current.data.entityVersion) {
      return previous.data.entityVersion === current.data.entityVersion
        ? 'match'
        : 'mismatch';
    }

    // Compare state fingerprints if available
    if (previous.data.stateFingerprint && current.data.stateFingerprint) {
      return previous.data.stateFingerprint === current.data.stateFingerprint
        ? 'match'
        : 'mismatch';
    }

    return 'unknown';
  }

  private evaluateVerificationPolicyFreshness(
    previous: EvidenceValidityContext,
    current: Partial<EvidenceValidityContext>,
  ): FreshnessMatch {
    if (!previous.verificationPolicy && !current.verificationPolicy) {
      return 'not-applicable';
    }

    if (!previous.verificationPolicy || !current.verificationPolicy) {
      return 'unknown';
    }

    // Compare fingerprints if available
    if (previous.verificationPolicy.fingerprint && current.verificationPolicy.fingerprint) {
      return previous.verificationPolicy.fingerprint === current.verificationPolicy.fingerprint
        ? 'match'
        : 'mismatch';
    }

    // Compare verification intents if available
    if (previous.verificationPolicy.verificationIntent && current.verificationPolicy.verificationIntent) {
      return previous.verificationPolicy.verificationIntent === current.verificationPolicy.verificationIntent
        ? 'match'
        : 'mismatch';
    }

    return 'unknown';
  }

  private evaluateCapabilityFreshness(
    previous: EvidenceValidityContext,
    current: Partial<EvidenceValidityContext>,
  ): FreshnessMatch {
    if (!previous.capabilities && !current.capabilities) {
      return 'not-applicable';
    }

    if (!previous.capabilities || !current.capabilities) {
      return 'unknown';
    }

    // Compare executor types
    const prevExecutorTypes = new Set(previous.capabilities.executorTypes);
    const currExecutorTypes = new Set(current.capabilities.executorTypes);

    // Check if current has all previous capabilities
    for (const cap of prevExecutorTypes) {
      if (!currExecutorTypes.has(cap)) {
        return 'mismatch';
      }
    }

    // Compare journey enabled
    if (previous.capabilities.journeyEnabled !== current.capabilities.journeyEnabled) {
      return 'mismatch';
    }

    return 'match';
  }

  private evaluateTimeFreshness(
    previous: EvidenceValidityContext,
    current: Partial<EvidenceValidityContext>,
  ): FreshnessMatch {
    // If no validity window, not applicable
    if (!previous.validUntil) {
      return 'not-applicable';
    }

    // Check if validity window has expired
    const validUntil = new Date(previous.validUntil);
    const now = new Date();

    return now <= validUntil ? 'match' : 'mismatch';
  }

  // ---- Decision Helpers ---------------------------------------------------

  private determineDecision(
    freshnessMatches: Record<FreshnessDimension, FreshnessMatch>,
  ): { decision: ExecutionDecision; reasons: ExecutionReason[] } {
    const reasons: ExecutionReason[] = [];
    let hasMismatch = false;
    let hasUnknown = false;

    for (const [dimension, match] of Object.entries(freshnessMatches)) {
      if (match === 'mismatch') {
        hasMismatch = true;
        reasons.push(this.dimensionToReason(dimension as FreshnessDimension));
      } else if (match === 'unknown') {
        hasUnknown = true;
        reasons.push('unknown-freshness');
      }
    }

    if (hasMismatch) {
      return { decision: 'invalidated', reasons };
    }

    if (hasUnknown) {
      return { decision: 'unknown-retest', reasons };
    }

    return { decision: 'safe-reuse', reasons: [] };
  }

  private dimensionToReason(dimension: FreshnessDimension): ExecutionReason {
    switch (dimension) {
      case 'spec':
        return 'requirement-changed';
      case 'requirement':
        return 'requirement-changed';
      case 'testcase':
        return 'testcase-changed';
      case 'expected-result':
        return 'expected-result-changed';
      case 'application':
        return 'application-changed';
      case 'environment':
        return 'environment-changed';
      case 'data':
        return 'data-changed';
      case 'verification-policy':
        return 'verification-changed';
      case 'capability':
        return 'capability-changed';
      case 'time':
        return 'evidence-expired';
      default:
        return 'unknown-freshness';
    }
  }

  private createDefaultMatches(): Record<FreshnessDimension, FreshnessMatch> {
    return {
      spec: 'unknown',
      requirement: 'unknown',
      testcase: 'unknown',
      'expected-result': 'unknown',
      application: 'unknown',
      environment: 'unknown',
      data: 'unknown',
      'verification-policy': 'unknown',
      capability: 'unknown',
      time: 'unknown',
    };
  }
}
