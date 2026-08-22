// ---------------------------------------------------------------------------
// Requirement Builder – extraction prompt
// ---------------------------------------------------------------------------
// Builds the user message for requirement candidate extraction from a
// semantic evidence batch.

import type { SemanticIRInput } from '../models.js';

/**
 * A bounded batch of semantic evidence for requirement extraction.
 */
export interface EvidenceBatch {
  label: string;
  flows: SemanticIRInput['flows'];
  rules: SemanticIRInput['rules'];
  entities: SemanticIRInput['entities'];
  relationships: SemanticIRInput['relationships'];
  sections: SemanticIRInput['sections'];
}

/**
 * Build the extraction prompt for a batch of semantic evidence.
 */
export function buildExtractionPrompt(batch: EvidenceBatch): string {
  const parts: string[] = [];

  parts.push('# REQUIREMENT CANDIDATE EXTRACTION');
  parts.push('');
  parts.push('Analyze the following semantic evidence and extract requirement candidates.');
  parts.push('');

  // ---- What is/isn't a requirement ----
  parts.push('## WHAT IS A REQUIREMENT?');
  parts.push('A verifiable system obligation: behavior, constraint, expected state, business rule.');
  parts.push('');
  parts.push('## WHAT IS NOT A REQUIREMENT?');
  parts.push('Entity names alone. Inventory. Design decisions without evidence. Assumptions.');
  parts.push('');

  // ---- Explicit vs Derived ----
  parts.push('## EXPLICIT VS DERIVED');
  parts.push('explicit: Source directly states the obligation.');
  parts.push('derived: Obligation follows from flow steps, rules, or relationships with clear evidence.');
  parts.push('ambiguous: Indication exists but evidence is insufficient.');
  parts.push('');

  // ---- Flow → Requirement ----
  parts.push('## FLOW → REQUIREMENT');
  parts.push('For each flow, identify system obligations implied by the process:');
  parts.push('  - Input submission obligations');
  parts.push('  - Validation obligations');
  parts.push('  - Processing/call obligations');
  parts.push('  - Branching/conditional obligations');
  parts.push('  - Navigation/result obligations');
  parts.push('Do NOT mechanically create one requirement per step.');
  parts.push('');

  // ---- Rule → Requirement ----
  parts.push('## RULE → REQUIREMENT');
  parts.push('Rules often map to validation or business-rule requirements.');
  parts.push('Deduplicate with flow-derived requirements if same obligation.');
  parts.push('');

  // ---- Entity Usage ----
  parts.push('## ENTITY USAGE');
  parts.push('Use entities to identify actors, inputs, targets, domain context.');
  parts.push('Do NOT create requirements from entity names alone.');
  parts.push('');

  // ---- Relationship Usage ----
  parts.push('## RELATIONSHIP USAGE');
  parts.push('Relationships provide supporting evidence but do not automatically become requirements.');
  parts.push('');

  // ---- Testability ----
  parts.push('## TESTABILITY');
  parts.push('For each candidate, assess testability:');
  parts.push('  testable: Clear measurable criteria');
  parts.push('  partially-testable: Some verifiable aspects');
  parts.push('  not-testable: No measurable criterion');
  parts.push('  unknown: Cannot determine from evidence');
  parts.push('');

  // ---- Evidence ----
  parts.push('## EVIDENCE REQUIREMENTS');
  parts.push('Every candidate MUST have:');
  parts.push('  - semanticEvidenceIds referencing the semantic objects used');
  parts.push('  - provenance referencing the source context');
  parts.push('  - confidence between 0.0 and 1.0');
  parts.push('');

  // ---- Ambiguity ----
  parts.push('## AMBIGUITY');
  parts.push('If evidence is insufficient, emit as unresolvedCandidate instead of guessing.');
  parts.push('');

  // ---- Source context ----
  parts.push('## SEMANTIC EVIDENCE BATCH');
  parts.push(`Batch: ${batch.label}`);
  parts.push('');

  if (batch.flows.length > 0) {
    parts.push('### FLOWS');
    for (const f of batch.flows) {
      parts.push(`Flow: ${f.id} — ${f.name}`);
      if (f.description) parts.push(`  Description: ${f.description}`);
      if (f.actors?.length) parts.push(`  Actors: ${f.actors.join(', ')}`);
      if (f.preconditions?.length) parts.push(`  Preconditions: ${f.preconditions.join('; ')}`);
      for (const step of f.steps) {
        const actor = step.actor ? ` [actor: ${step.actor}]` : '';
        const cond = step.condition ? ` [condition: ${step.condition}]` : '';
        const outcome = step.outcome ? ` [outcome: ${step.outcome}]` : '';
        parts.push(`  Step ${step.order}: ${step.action}${actor}${cond}${outcome}`);
      }
      if (f.postconditions?.length) parts.push(`  Postconditions: ${f.postconditions.join('; ')}`);
      parts.push(`  Provenance: ${f.provenance.map((p) => p.contextId).join(', ')}`);
      parts.push('');
    }
  }

  if (batch.rules.length > 0) {
    parts.push('### RULES');
    for (const r of batch.rules) {
      parts.push(`Rule: ${r.id} [${r.type}] — ${r.statement}`);
      if (r.conditions?.length) {
        for (const c of r.conditions) {
          parts.push(`  Condition: ${c.expression}`);
        }
      }
      if (r.effects?.length) {
        for (const e of r.effects) {
          parts.push(`  Effect: ${e.description}`);
        }
      }
      if (r.relatedEntityIds?.length) parts.push(`  Related entities: ${r.relatedEntityIds.join(', ')}`);
      parts.push(`  Provenance: ${r.provenance.map((p) => p.contextId).join(', ')}`);
      parts.push('');
    }
  }

  if (batch.entities.length > 0) {
    parts.push('### ENTITIES (context only — do NOT create requirements from names)');
    for (const e of batch.entities) {
      const desc = e.description ? ` — ${e.description}` : '';
      parts.push(`Entity: ${e.id} [${e.type}] — ${e.name}${desc}`);
    }
    parts.push('');
  }

  if (batch.relationships.length > 0) {
    parts.push('### RELATIONSHIPS');
    for (const r of batch.relationships) {
      parts.push(`Relationship: ${r.id} [${r.type}] — ${r.sourceId} → ${r.targetId}`);
      if (r.description) parts.push(`  ${r.description}`);
    }
    parts.push('');
  }

  if (batch.sections.length > 0) {
    parts.push('### SECTIONS');
    for (const s of batch.sections) {
      parts.push(`Section: ${s.id} — ${s.title}`);
    }
    parts.push('');
  }

  // ---- Output format ----
  parts.push('## OUTPUT');
  parts.push('Respond with JSON:');
  parts.push('{');
  parts.push('  "candidates": [ ... ],');
  parts.push('  "unresolvedCandidates": [ ... ],');
  parts.push('  "conflictCandidates": [ ... ]');
  parts.push('}');
  parts.push('');
  parts.push('Each candidate must have: temporaryId, title, type, statement, sourceNature,');
  parts.push('semanticEvidenceIds, provenance, confidence.');
  parts.push('Optional: actor, trigger, preconditions, inputs, expectedBehaviors, outcomes,');
  parts.push('constraints, rationale.');

  return parts.join('\n');
}
