import type { AIProvider } from 'ai-provider';
import type { BrowserObservation, TestCase } from './models.js';

export type VerificationSource = 'UI' | 'API' | 'DATABASE';
export type VerificationConfidence = 'required' | 'supporting';

export interface EntityReference {
  entityType: string;
  bindingRef?: string;
  businessKey?: string;
}

export type SemanticExpectation =
  | { kind: 'equals'; value: string | number | boolean }
  | { kind: 'exists' }
  | { kind: 'absent' }
  | { kind: 'count'; value: number }
  | { kind: 'delta'; value: number };

export interface VerificationNeed {
  id: string;
  subject: EntityReference;
  property?: string;
  expectation: SemanticExpectation;
  preferredSources?: VerificationSource[];
  requiredSources?: VerificationSource[];
  authority?: VerificationSource;
  confidence?: VerificationConfidence;
  consistency?: { maxAttempts: number; intervalMs: number };
}

export interface RawEvidence {
  source: VerificationSource;
  acquisitionRef: string;
  entityKey: string;
  property?: string;
  rawValue: unknown;
  normalizedValue?: unknown;
  mappingKnown?: boolean;
  phase?: 'before' | 'after';
  provenance: { kind: string; reference: string };
  sensitive?: boolean;
}

export interface VerificationAcquisitionRequest {
  need: VerificationNeed;
  bindings: { resolve(name: string): { value: unknown; sensitive: boolean } | undefined };
  observation?: BrowserObservation;
}

export interface VerificationSourceAdapter {
  readonly source: VerificationSource;
  readonly readOnly: true;
  acquire(request: VerificationAcquisitionRequest): Promise<RawEvidence[]>;
}

export interface VerificationPlan {
  needs: VerificationNeed[];
  acquisitions: VerificationSource[];
}

export interface VerificationRuntime {
  plan: VerificationPlan | ((testCase: TestCase) => VerificationPlan);
  sources: Partial<Record<VerificationSource, VerificationSourceAdapter>>;
  maxVerificationAcquisitions?: number;
  maxVerificationAttempts?: number;
  maxVerificationAICalls?: number;
  aiProvider?: AIProvider;
}

export interface NormalizedFact {
  source: VerificationSource;
  entityKey: string;
  property?: string;
  value: unknown;
  phase?: 'before' | 'after';
  provenance: { kind: string; reference: string };
}

export type VerificationResultStatus = 'VERIFIED' | 'CONTRADICTED' | 'INSUFFICIENT_EVIDENCE' | 'ACQUISITION_ERROR';

export interface VerificationEvidenceView {
  id: string;
  source: VerificationSource;
  entityKey: string;
  property?: string;
  normalizedValue?: unknown;
  provenance: { kind: string; reference: string };
}

export interface VerificationNeedResult {
  needId: string;
  status: VerificationResultStatus;
  facts: NormalizedFact[];
  reason?: string;
}

export interface VerificationReport {
  status: VerificationResultStatus;
  needs: VerificationNeedResult[];
  evidence: VerificationEvidenceView[];
  acquisitions: number;
  verificationAICalls: number;
  conflicts: Array<{ needId: string; sources: VerificationSource[]; values: unknown[] }>;
  explanation: string;
}

export async function verifyCrossLayer(
  testCase: TestCase,
  runtime: VerificationRuntime,
  bindings: { resolve(name: string): { value: unknown; sensitive: boolean } | undefined },
  observation?: BrowserObservation,
): Promise<VerificationReport> {
  const plan = typeof runtime.plan === 'function' ? runtime.plan(testCase) : runtime.plan;
  const maxAcquisitions = runtime.maxVerificationAcquisitions ?? 6;
  const evidence: VerificationEvidenceView[] = [];
  const results: VerificationNeedResult[] = [];
  const conflicts: VerificationReport['conflicts'] = [];
  let acquisitions = 0;

  for (const need of plan.needs) {
    const sources = (need.requiredSources?.length ? need.requiredSources : need.preferredSources?.length ? need.preferredSources : plan.acquisitions);
    const facts: NormalizedFact[] = [];
    const acquisitionErrors: string[] = [];
    let missingRequiredSource = false;
    let requiredAcquisitionError = false;
    const candidateEntityKeys = new Set<string>();
    for (const source of sources) {
      if (acquisitions >= maxAcquisitions) {
        results.push({ needId: need.id, status: 'INSUFFICIENT_EVIDENCE', facts, reason: 'Verification acquisition budget exhausted.' });
        break;
      }
      const adapter = runtime.sources[source];
      if (!adapter || adapter.readOnly !== true) {
        if (need.requiredSources?.includes(source)) missingRequiredSource = true;
        continue;
      }
      const attempts = Math.max(1, need.consistency?.maxAttempts ?? runtime.maxVerificationAttempts ?? 1);
      let acquired: RawEvidence[] = [];
      try {
        for (let attempt = 0; attempt < attempts; attempt++) {
          if (acquisitions >= maxAcquisitions) break;
          acquisitions++;
          acquired = await adapter.acquire({ need, bindings, observation });
          for (const raw of acquired) {
          if (raw.sensitive) continue;
          if (!raw.property || !need.property || raw.property === need.property) candidateEntityKeys.add(raw.entityKey);
          if (raw.entityKey !== correlationKey(need.subject)) continue;
          if (raw.property && need.property && raw.property !== need.property) continue;
          if (raw.mappingKnown === false || raw.normalizedValue === undefined) continue;
          const fact: NormalizedFact = { source: raw.source, entityKey: raw.entityKey, property: raw.property, value: raw.normalizedValue, phase: raw.phase, provenance: raw.provenance };
          facts.push(fact);
          evidence.push({ id: `VER-${evidence.length + 1}`, source: fact.source, entityKey: fact.entityKey, property: fact.property, normalizedValue: fact.value, provenance: fact.provenance });
          }
          if (attempt + 1 < attempts && need.consistency?.intervalMs) await boundedVerificationWait(need.consistency.intervalMs);
        }
      } catch (error) {
        if (need.requiredSources?.includes(source)) requiredAcquisitionError = true;
        acquisitionErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (results.some((result) => result.needId === need.id)) continue;
    const distinctKeys = new Set(facts.map((fact) => fact.entityKey));
    if (requiredAcquisitionError) {
      results.push({ needId: need.id, status: 'ACQUISITION_ERROR', facts, reason: acquisitionErrors.join('; ') });
      continue;
    }
    if (missingRequiredSource) {
      results.push({ needId: need.id, status: 'INSUFFICIENT_EVIDENCE', facts, reason: 'Required verification capability unavailable.' });
      continue;
    }
    if (acquisitionErrors.length > 0 && facts.length === 0) {
      results.push({ needId: need.id, status: 'ACQUISITION_ERROR', facts, reason: acquisitionErrors.join('; ') });
      continue;
    }
    if (candidateEntityKeys.size > 1 || distinctKeys.size !== 1 || facts.length === 0) {
      results.push({ needId: need.id, status: 'INSUFFICIENT_EVIDENCE', facts, reason: candidateEntityKeys.size > 1 ? 'Ambiguous entity correlation.' : 'Required evidence is unavailable or unmapped.' });
      continue;
    }
    const comparableFacts = need.consistency ? latestFactsBySource(facts) : facts;
    const conflictValues = need.expectation.kind === 'delta' ? [] : uniqueValues(comparableFacts.map((fact) => fact.value));
    if (conflictValues.length > 1) {
      conflicts.push({ needId: need.id, sources: comparableFacts.map((fact) => fact.source), values: conflictValues });
      results.push({ needId: need.id, status: 'CONTRADICTED', facts: comparableFacts, reason: 'Correlated sources disagree.' });
      continue;
    }
    const evaluated = evaluateNeed(need, comparableFacts);
    results.push({ needId: need.id, status: evaluated.status, facts: comparableFacts, reason: evaluated.reason });
  }

  const status = results.some((result) => result.status === 'ACQUISITION_ERROR') ? 'ACQUISITION_ERROR'
    : results.some((result) => result.status === 'CONTRADICTED') ? 'CONTRADICTED'
      : results.some((result) => result.status === 'INSUFFICIENT_EVIDENCE') ? 'INSUFFICIENT_EVIDENCE' : 'VERIFIED';
  const explanation = results.map((result) => `${result.needId}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`).join('; ');
  return { status, needs: results, evidence, acquisitions, verificationAICalls: 0, conflicts, explanation };
}

export function correlationKey(subject: EntityReference): string {
  return subject.bindingRef ?? subject.businessKey ?? `${subject.entityType}:unknown`;
}

function evaluateNeed(need: VerificationNeed, facts: NormalizedFact[]): { status: VerificationResultStatus; reason?: string } {
  const authorityFacts = need.authority ? facts.filter((fact) => fact.source === need.authority) : facts;
  const selected = authorityFacts.length > 0 ? authorityFacts : facts;
  if (need.expectation.kind === 'delta') {
    const before = selected.find((fact) => fact.phase === 'before')?.value;
    const after = selected.find((fact) => fact.phase === 'after')?.value;
    if (typeof before !== 'number' || typeof after !== 'number') return { status: 'INSUFFICIENT_EVIDENCE', reason: 'Baseline and after values are required for delta.' };
    return after - before === need.expectation.value ? { status: 'VERIFIED' } : { status: 'CONTRADICTED', reason: `Expected delta ${need.expectation.value}, observed ${after - before}.` };
  }
  const value = selected[0]?.value;
  if (need.expectation.kind === 'exists') return value === true || value === 'PRESENT' ? { status: 'VERIFIED' } : { status: 'CONTRADICTED' };
  if (need.expectation.kind === 'absent') return value === false || value === 'ABSENT' ? { status: 'VERIFIED' } : { status: 'CONTRADICTED' };
  if (need.expectation.kind === 'count') return value === need.expectation.value ? { status: 'VERIFIED' } : { status: 'CONTRADICTED' };
  return value === need.expectation.value ? { status: 'VERIFIED' } : { status: 'CONTRADICTED', reason: `Expected ${String(need.expectation.value)}, observed ${String(value)}.` };
}

function uniqueValues(values: unknown[]): unknown[] {
  return values.filter((value, index) => values.findIndex((candidate) => Object.is(candidate, value)) === index);
}

function latestFactsBySource(facts: NormalizedFact[]): NormalizedFact[] {
  const latest = new Map<VerificationSource, NormalizedFact>();
  for (const fact of facts) latest.set(fact.source, fact);
  return [...latest.values()];
}

async function boundedVerificationWait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(milliseconds, 0), 250)));
}
