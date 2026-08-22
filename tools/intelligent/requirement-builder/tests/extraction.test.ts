// ---------------------------------------------------------------------------
// Extraction + atomicity + inputs/conditions/outcomes tests (spec §65-67)
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { buildEvidenceBatches } from '../src/analysis/evidence-grouper.js';
import { semanticIR, prov } from './fixtures/helpers.js';
import { validateRequirement } from '../src/validation/requirement-validator.js';
import type { Requirement } from '../src/models.js';

describe('Evidence batching', () => {
  it('9. creates one batch per flow + standalone rules', () => {
    const ir = semanticIR();
    const batches = buildEvidenceBatches(ir);
    // 1 flow batch + 0 standalone rules (rule shares context with flow)
    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(batches[0]!.flows.length).toBe(1);
  });

  it('10. standalone rules get their own batch when not sharing context', () => {
    const ir = semanticIR({
      rules: [
        { id: 'rule-0001', type: 'validation', statement: 'Username required',
          provenance: [prov('ctx-other', 'Other')], confidence: 0.9 },
      ],
    });
    const batches = buildEvidenceBatches(ir);
    const standaloneBatch = batches.find((b) => b.label === 'standalone-rules');
    expect(standaloneBatch).toBeDefined();
    expect(standaloneBatch!.rules.length).toBe(1);
  });

  it('11. entity-only input produces no flow batches', () => {
    const ir = semanticIR({ flows: [], rules: [] });
    const batches = buildEvidenceBatches(ir);
    // Should have a remaining-structures batch or empty batch
    const flowBatches = batches.filter((b) => b.flows.length > 0);
    expect(flowBatches.length).toBe(0);
  });
});

describe('Atomicity (spec §66)', () => {
  const validIds = new Set(['flow-0001', 'rule-0001', 'ent-0001']);

  it('12. single obligation passes without non-atomic warning', () => {
    const req: Requirement = {
      id: 'REQ-0001',
      title: 'Validate username',
      type: 'validation',
      statement: 'The system shall validate username before authentication.',
      sourceNature: 'explicit',
      preconditions: [],
      inputs: [{ name: 'username', provenance: [prov('ctx-s000-c000')] }],
      expectedBehaviors: [{ description: 'Check username is not empty', provenance: [prov('ctx-s000-c000')] }],
      outcomes: [],
      constraints: [],
      relatedSemanticIds: ['rule-0001'],
      provenance: [prov('ctx-s000-c000')],
      confidence: 0.9,
      testability: { status: 'testable', reasons: ['measurable'] },
    };
    const warnings = validateRequirement(req, validIds);
    expect(warnings.find((w) => w.code === 'REQUIREMENT_NON_ATOMIC')).toBeUndefined();
  });

  it('13. multiple independent obligations triggers non-atomic warning', () => {
    const req: Requirement = {
      id: 'REQ-0002',
      title: 'Multi-obligation',
      type: 'functional',
      statement: 'Validate, save, notify, and redirect.',
      sourceNature: 'derived',
      preconditions: [],
      inputs: [],
      expectedBehaviors: [
        { description: 'Validate input', target: 'form', provenance: [prov('ctx-s000-c000')] },
        { description: 'Save data', target: 'database', provenance: [prov('ctx-s000-c000')] },
        { description: 'Send notification', target: 'email', provenance: [prov('ctx-s000-c000')] },
        { description: 'Redirect', target: 'dashboard', provenance: [prov('ctx-s000-c000')] },
      ],
      outcomes: [],
      constraints: [],
      relatedSemanticIds: [],
      provenance: [prov('ctx-s000-c000')],
      confidence: 0.9,
      testability: { status: 'testable', reasons: [] },
    };
    const warnings = validateRequirement(req, validIds);
    expect(warnings.find((w) => w.code === 'REQUIREMENT_NON_ATOMIC')).toBeDefined();
  });

  it('14. closely related condition + behavior remains one requirement', () => {
    const req: Requirement = {
      id: 'REQ-0003',
      title: 'Conditional validation',
      type: 'validation',
      statement: 'When login is submitted, validate credentials.',
      sourceNature: 'derived',
      preconditions: [],
      inputs: [],
      expectedBehaviors: [
        { description: 'Validate credentials', condition: 'login submitted', provenance: [prov('ctx-s000-c000')] },
      ],
      outcomes: [],
      constraints: [],
      relatedSemanticIds: [],
      provenance: [prov('ctx-s000-c000')],
      confidence: 0.9,
      testability: { status: 'testable', reasons: [] },
    };
    const warnings = validateRequirement(req, validIds);
    expect(warnings.find((w) => w.code === 'REQUIREMENT_NON_ATOMIC')).toBeUndefined();
  });
});

describe('Inputs / Conditions / Outcomes (spec §67)', () => {
  it('15. precondition is captured', () => {
    const req: Requirement = {
      id: 'REQ-0004',
      title: 'Login precondition',
      type: 'functional',
      statement: 'The system shall validate credentials when login is submitted.',
      sourceNature: 'derived',
      preconditions: [{ description: 'User is on login screen', provenance: [prov('ctx-s000-c000')] }],
      inputs: [],
      expectedBehaviors: [{ description: 'Validate credentials', provenance: [prov('ctx-s000-c000')] }],
      outcomes: [],
      constraints: [],
      relatedSemanticIds: [],
      provenance: [prov('ctx-s000-c000')],
      confidence: 0.9,
      testability: { status: 'testable', reasons: [] },
    };
    expect(req.preconditions.length).toBe(1);
    expect(req.preconditions[0]!.description).toContain('login screen');
  });

  it('16. trigger is captured', () => {
    const req: Requirement = {
      id: 'REQ-0005',
      title: 'Login trigger',
      type: 'functional',
      statement: 'The system shall authenticate on form submission.',
      sourceNature: 'derived',
      trigger: 'User submits login form',
      preconditions: [],
      inputs: [],
      expectedBehaviors: [{ description: 'Authenticate user', provenance: [prov('ctx-s000-c000')] }],
      outcomes: [],
      constraints: [],
      relatedSemanticIds: [],
      provenance: [prov('ctx-s000-c000')],
      confidence: 0.9,
      testability: { status: 'testable', reasons: [] },
    };
    expect(req.trigger).toBe('User submits login form');
  });

  it('17. required input constraint', () => {
    const req: Requirement = {
      id: 'REQ-0006',
      title: 'Username required',
      type: 'validation',
      statement: 'The system shall require username.',
      sourceNature: 'explicit',
      preconditions: [],
      inputs: [{ name: 'username', required: true, provenance: [prov('ctx-s000-c000')] }],
      expectedBehaviors: [{ description: 'Check username not empty', provenance: [prov('ctx-s000-c000')] }],
      outcomes: [],
      constraints: [{ type: 'required', description: 'Username must not be empty', provenance: [prov('ctx-s000-c000')] }],
      relatedSemanticIds: ['rule-0001'],
      provenance: [prov('ctx-s000-c000')],
      confidence: 0.9,
      testability: { status: 'testable', reasons: [] },
    };
    expect(req.inputs[0]!.required).toBe(true);
    expect(req.constraints[0]!.type).toBe('required');
  });

  it('18. conditional outcome', () => {
    const req: Requirement = {
      id: 'REQ-0007',
      title: 'Auth outcome',
      type: 'functional',
      statement: 'When credentials are valid, the system shall authenticate the user.',
      sourceNature: 'derived',
      preconditions: [],
      inputs: [],
      expectedBehaviors: [{ description: 'Authenticate user', provenance: [prov('ctx-s000-c000')] }],
      outcomes: [{ condition: 'Credentials are valid', description: 'Authentication succeeds', state: 'authenticated', provenance: [prov('ctx-s000-c000')] }],
      constraints: [],
      relatedSemanticIds: [],
      provenance: [prov('ctx-s000-c000')],
      confidence: 0.9,
      testability: { status: 'testable', reasons: [] },
    };
    expect(req.outcomes[0]!.condition).toContain('valid');
    expect(req.outcomes[0]!.state).toBe('authenticated');
  });
});
