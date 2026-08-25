import type { BrowserObservation, ObservedElement, TestCase } from './models.js';

export type SourceHintKind =
  | 'NAVIGATION_HINT'
  | 'SCREEN_HINT'
  | 'ACTION_HINT'
  | 'FIELD_HINT'
  | 'VALIDATION_HINT'
  | 'API_HINT'
  | 'ENTITY_HINT'
  | 'PERSISTENCE_HINT'
  | 'RELATIONSHIP_HINT'
  | 'VERIFICATION_HINT';

export type SourceHintConfidence = 'DECLARED' | 'DERIVED' | 'INFERRED';
export type SourceHintLifecycle = 'DISCOVERED' | 'SUGGESTED' | 'CONFIRMED' | 'REJECTED' | 'STALE';

export interface SourceHintProvenance {
  source: string;
  reference: string;
  confidence: SourceHintConfidence;
}

export interface SourceHint {
  id: string;
  kind: SourceHintKind;
  semanticName: string;
  routePattern?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  operationRef?: string;
  entity?: string;
  details?: Record<string, string>;
  provenance: SourceHintProvenance;
  lifecycle: SourceHintLifecycle;
}

export interface SourceIntelligence {
  schemaVersion: '1.0';
  snapshotId: string;
  hints: SourceHint[];
  sourceSecrets: 0;
}

export interface SourceIntelligenceRequest {
  projectRoot?: string;
  testCase: TestCase;
}

export interface SourceIntelligenceProvider {
  discover(request: SourceIntelligenceRequest): Promise<SourceIntelligence>;
}

export interface SourceHintResolution {
  available: number;
  provided: SourceHint[];
  used: SourceHint[];
  confirmed: SourceHint[];
  rejected: SourceHint[];
  stale: SourceHint[];
}

export interface SourceProfileLike {
  fingerprint?: string;
  provenance?: Array<{ source: string }>;
  ui?: { catalog?: { pages?: Array<{ id: string; route?: string; elements?: Array<{ logicalName: string }> }> } };
  api?: { operations?: Array<{ id: string; method: SourceHint['method']; path: string }>; mappings?: Array<{ logicalEntity: string; operationIds?: string[] }> };
  database?: { catalogs?: Array<{ resourceId: string; schemas?: Array<{ name: string; tables?: Array<{ name: string }> }> }> };
}

/** Converts existing Project Adapter catalogs to semantic hints only. */
export function sourceIntelligenceFromProjectProfile(profile: SourceProfileLike): SourceIntelligence {
  const hints: SourceHint[] = [];
  const source = profile.provenance?.[0]?.source ?? 'project-profile';
  const provenance = (reference: string, confidence: SourceHintConfidence = 'DECLARED'): SourceHintProvenance => ({ source, reference, confidence });
  for (const page of profile.ui?.catalog?.pages ?? []) {
    const screen = page.id.replace(/[-_]/g, ' ');
    if (page.route) hints.push({ id: `route:${page.id}`, kind: 'NAVIGATION_HINT', semanticName: screen, routePattern: page.route, provenance: provenance(`ui.pages.${page.id}.route`), lifecycle: 'DISCOVERED' });
    hints.push({ id: `screen:${page.id}`, kind: 'SCREEN_HINT', semanticName: screen, routePattern: page.route, provenance: provenance(`ui.pages.${page.id}`), lifecycle: 'DISCOVERED' });
    for (const element of page.elements ?? []) {
      hints.push({ id: `action:${page.id}:${element.logicalName}`, kind: 'ACTION_HINT', semanticName: element.logicalName.replace(/[-_]/g, ' '), routePattern: page.route, provenance: provenance(`ui.pages.${page.id}.elements.${element.logicalName}`), lifecycle: 'DISCOVERED' });
    }
  }
  for (const operation of profile.api?.operations ?? []) {
    hints.push({ id: `api:${operation.id}`, kind: 'API_HINT', semanticName: operation.id.replace(/[-_]/g, ' '), method: operation.method, operationRef: operation.id, details: { pathPattern: operation.path }, provenance: provenance(`api.operations.${operation.id}`), lifecycle: 'DISCOVERED' });
  }
  for (const mapping of profile.api?.mappings ?? []) {
    hints.push({ id: `entity:${mapping.logicalEntity}`, kind: 'ENTITY_HINT', semanticName: mapping.logicalEntity, details: { operationRefs: (mapping.operationIds ?? []).join(',') }, provenance: provenance(`api.mappings.${mapping.logicalEntity}`), lifecycle: 'DISCOVERED' });
  }
  for (const catalog of profile.database?.catalogs ?? []) {
    for (const schema of catalog.schemas ?? []) {
      for (const table of schema.tables ?? []) {
        hints.push({ id: `persistence:${catalog.resourceId}:${schema.name}:${table.name}`, kind: 'PERSISTENCE_HINT', semanticName: table.name.replace(/[-_]/g, ' '), details: { resourceRef: catalog.resourceId, schema: schema.name }, provenance: provenance(`database.${catalog.resourceId}.${schema.name}.${table.name}`), lifecycle: 'DISCOVERED' });
      }
    }
  }
  return { schemaVersion: '1.0', snapshotId: profile.fingerprint ?? 'profile-snapshot', hints: sanitizeHints(hints), sourceSecrets: 0 };
}

export class StaticSourceIntelligenceProvider implements SourceIntelligenceProvider {
  constructor(private readonly intelligence: SourceIntelligence) {}
  async discover(_request: SourceIntelligenceRequest): Promise<SourceIntelligence> { return sanitizeIntelligence(this.intelligence); }
}

export function resolveRelevantSourceHints(intelligence: SourceIntelligence, testCase: TestCase, currentState: string, limit = 8): SourceHintResolution {
  const query = `${testCase.title} ${testCase.objective} ${testCase.expectedResults.map((result) => result.description).join(' ')} ${currentState}`.toLowerCase();
  const scored = intelligence.hints.map((hint) => ({ hint, score: keywordScore(query, `${hint.semanticName} ${hint.kind} ${hint.details ? Object.values(hint.details).join(' ') : ''}`) }));
  const provided = scored.sort((a, b) => b.score - a.score).filter((entry) => entry.score > 0 || entry.hint.kind === 'ACTION_HINT').slice(0, limit).map((entry) => ({ ...entry.hint, lifecycle: entry.hint.lifecycle === 'DISCOVERED' ? 'SUGGESTED' as const : entry.hint.lifecycle }));
  return { available: intelligence.hints.length, provided, used: [], confirmed: [], rejected: [], stale: [] };
}

export function confirmSourceHints(hints: SourceHint[], observation: BrowserObservation): SourceHintResolution {
  const confirmed: SourceHint[] = [];
  const rejected: SourceHint[] = [];
  for (const hint of hints) {
    if (hint.lifecycle === 'STALE' || hint.lifecycle === 'REJECTED') {
      rejected.push({ ...hint, lifecycle: hint.lifecycle });
      continue;
    }
    const routeMatches = !hint.routePattern || routePatternMatches(hint.routePattern, observation.url);
    const semanticMatches = semanticElementMatches(hint.semanticName, observation.elements) || new RegExp(escapeRegExp(hint.semanticName), 'i').test(`${observation.title} ${observation.headings.join(' ')} ${observation.pageText}`);
    if ((hint.kind === 'NAVIGATION_HINT' || hint.kind === 'SCREEN_HINT') && routeMatches && semanticMatches) confirmed.push({ ...hint, lifecycle: 'CONFIRMED' });
    else if (hint.kind === 'ACTION_HINT' && semanticMatches) confirmed.push({ ...hint, lifecycle: 'CONFIRMED' });
  }
  return { available: hints.length, provided: hints, used: confirmed, confirmed, rejected, stale: rejected.filter((hint) => hint.lifecycle === 'STALE') };
}

export function groundConfirmedAction(hints: SourceHint[], observation: BrowserObservation): { elementId: string; hint: SourceHint } | undefined {
  for (const hint of hints.filter((candidate) => candidate.kind === 'ACTION_HINT')) {
    const element = observation.elements.find((candidate) => semanticTextMatches(hint.semanticName, candidate.visibleText, candidate.accessibleName, candidate.label));
    if (element) return { elementId: element.id, hint: { ...hint, lifecycle: 'CONFIRMED' } };
  }
  return undefined;
}

export function sanitizeIntelligence(intelligence: SourceIntelligence): SourceIntelligence {
  return { schemaVersion: '1.0', snapshotId: intelligence.snapshotId, hints: sanitizeHints(intelligence.hints), sourceSecrets: 0 };
}

function sanitizeHints(hints: SourceHint[]): SourceHint[] {
  return hints.map((hint) => ({ ...hint, details: hint.details ? Object.fromEntries(Object.entries(hint.details).filter(([key, value]) => !/(password|secret|token|cookie|authorization|connection)/i.test(key) && !/(password|secret|token|cookie|authorization)/i.test(value))) : undefined }));
}

function keywordScore(query: string, text: string): number {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)).size === 0 ? 0 : text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => query.includes(word)).length;
}

function semanticElementMatches(name: string, elements: ObservedElement[]): boolean {
  return elements.some((element) => semanticTextMatches(name, element.visibleText, element.accessibleName, element.label));
}

function semanticTextMatches(expected: string, ...values: Array<string | undefined>): boolean {
  const expectedWords = expected.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const actual = values.filter(Boolean).join(' ').toLowerCase();
  return expectedWords.length > 0 && expectedWords.every((word) => actual.includes(word));
}

function routePatternMatches(pattern: string, url: string): boolean {
  try {
    const path = new URL(url).pathname;
    const expression = pattern.split('/').map((segment) => segment.startsWith(':') ? '[^/]+' : escapeRegExp(segment)).join('/');
    const regex = new RegExp(`^${expression}$`);
    return regex.test(path);
  } catch { return false; }
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'); }
