// Playwright code generator (spec §8, §9, §15).
//
// Pure, deterministic translation of a canonical TestCase (grounded by a
// trusted ExecutionMappingIR + UIElementCatalog + ProjectExecutionProfile)
// into real Playwright test source.
//
// Hard guarantees:
//   * Zero AI calls (intelligence already happened upstream).
//   * Zero guessed selectors / routes / URLs / credentials.
//   * Fail-closed: any unmappable action/assertion/locator/value blocks the
//     whole test case instead of emitting an incomplete test (spec §9, §29-31).
//   * No source-specific (Excel/Markdown/PDF) branching.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import prettier from 'prettier';

import type {
  TestCase,
  ExecutionMappingIR,
  TestCodeGenerationInput,
  TestCodeGenerationResult,
  TestCaseGenerationResult,
  GenerationBlockReason,
  GenerationBlockCode,
  GenerationDiagnostic,
  GenerationMetrics,
} from './models.js';
import type {
  UIElementCatalog,
  UIElementDefinition,
  UIPageDefinition,
  UIStepMapping,
  UIAssertionMapping,
} from './re-export.js';
import { locatorExpression } from './locator.js';
import { sha256, artifactIdFrom, stableStringify } from './fingerprint.js';

// ---- Minimal supported generator action / assertion surface (spec §8) ------

const SUPPORTED_GENERATOR_ACTIONS = new Set([
  'navigate',
  'fill',
  'type',
  'click',
  'select',
  'check',
  'uncheck',
]);

const VALUE_REQUIRED_ACTIONS = new Set(['fill', 'type', 'select']);

const VALUE_REQUIRED_ASSERTIONS = new Set([
  'text-equals',
  'text-contains',
  'value-equals',
  'url-equals',
  'url-contains',
  'page-title',
  'element-count',
]);

const UNMAPPABLE_ASSERTIONS = new Set(['attribute-equals']);

interface CatalogIndex {
  pagesById: Map<string, UIPageDefinition>;
  elements: Map<string, { element: UIElementDefinition; page: UIPageDefinition }>;
}

function indexCatalog(catalog?: UIElementCatalog): CatalogIndex {
  const pagesById = new Map<string, UIPageDefinition>();
  const elements = new Map<string, { element: UIElementDefinition; page: UIPageDefinition }>();
  if (!catalog) return { pagesById, elements };
  for (const page of catalog.pages) {
    pagesById.set(page.id, page);
    for (const el of page.elements) {
      elements.set(el.logicalName, { element: el, page });
    }
  }
  return { pagesById, elements };
}

function joinBaseUrl(baseUrl: string, target: string): string {
  if (/^https?:\/\//i.test(target)) return target;
  const base = baseUrl.replace(/\/+$/, '');
  if (target.startsWith('/')) return base + target;
  return `${base}/${target}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeFileName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function secretEnvName(logicalName: string): string {
  return `TIRAI_SECRET_${logicalName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

// ---- Per-case generation --------------------------------------------------

interface CaseContext {
  testCase: TestCase;
  mapping: ExecutionMappingIR;
  catalog: CatalogIndex;
  baseUrl: string;
  diagnostics: GenerationDiagnostic[];
  trustedMappingsUsed: number;
  block?: GenerationBlockReason;
}

function classifyMissingMapping(
  unresolved: ExecutionMappingIR['unresolved'],
  entry: ExecutionMappingIR['testMappings'][number] | undefined,
): GenerationBlockReason {
  if (unresolved.some((u) => u.reason === 'unsupported-action')) {
    return { code: 'UNSUPPORTED_ACTION', message: 'Untrusted/unsupported action in mapping' };
  }
  if (unresolved.some((u) => u.reason === 'unsupported-assertion')) {
    return { code: 'UNMAPPABLE_ASSERTION', message: 'Unmappable assertion in mapping' };
  }
  if (
    unresolved.some((u) =>
      ['missing-catalog-entry', 'ambiguous-target', 'missing-binding'].includes(u.reason),
    )
  ) {
    return { code: 'MISSING_LOCATOR', message: 'Missing trusted locator / binding in mapping' };
  }
  if (!entry || !entry.ui) {
    return { code: 'MISSING_MAPPING', message: 'No trusted execution mapping for test case' };
  }
  return {
    code: 'MISSING_MAPPING',
    message: `Test case mapping is not fully ready (status=${entry?.status ?? 'none'})`,
  };
}

function recordBlock(
  ctx: CaseContext,
  code: GenerationBlockCode,
  message: string,
  loc?: { stepOrder?: number; expectedResultIndex?: number },
): void {
  if (!ctx.block) {
    ctx.block = { code, message, ...loc };
  }
  ctx.diagnostics.push({ severity: 'blocked', message, ...loc });
}

function resolveElement(
  ctx: CaseContext,
  logicalName: string | undefined,
  stepOrder?: number,
  expectedResultIndex?: number,
): UIElementDefinition | undefined {
  if (!logicalName) return undefined;
  const found = ctx.catalog.elements.get(logicalName);
  if (!found) {
    recordBlock(
      ctx,
      'MISSING_LOCATOR',
      `No trusted locator for logical name '${logicalName}' (not present in UIElementCatalog)`,
      { stepOrder, expectedResultIndex },
    );
    return undefined;
  }
  ctx.trustedMappingsUsed++;
  return found.element;
}

function buildNavigateUrl(
  ctx: CaseContext,
  step: UIStepMapping,
): string | undefined {
  const explicit =
    step.valueLiteral ?? ctx.testCase.steps.find((s) => s.order === step.stepOrder)?.input;
  if (explicit && typeof explicit === 'string' && explicit.length > 0) {
    return joinBaseUrl(ctx.baseUrl, explicit);
  }
  if (step.targetLogicalName) {
    const page = ctx.catalog.pagesById.get(step.targetLogicalName);
    if (page?.route) {
      ctx.trustedMappingsUsed++;
      return joinBaseUrl(ctx.baseUrl, page.route);
    }
  }
  return undefined;
}

function resolveFillValue(
  ctx: CaseContext,
  element: UIElementDefinition | undefined,
  step: UIStepMapping,
): string | undefined {
  if (element?.sensitive) {
    // Secret-safe: never embed the literal. Reference an external runtime env var.
    ctx.trustedMappingsUsed++;
    return `process.env[${JSON.stringify(secretEnvName(element.logicalName))}]`;
  }
  const literal =
    step.valueLiteral ?? ctx.testCase.steps.find((s) => s.order === step.stepOrder)?.input;
  if (literal === undefined || literal === '') return undefined;
  ctx.trustedMappingsUsed++;
  return JSON.stringify(String(literal));
}

function resolveAssertionValue(
  ctx: CaseContext,
  assertion: UIAssertionMapping,
): string | undefined {
  const fromMapping = assertion.expectedValue;
  const fromCase = ctx.testCase.expectedResults[assertion.expectedResultIndex]?.verificationIntent
    ?.expectedValue;
  const raw = fromMapping ?? (typeof fromCase === 'string' || typeof fromCase === 'number' ? String(fromCase) : undefined);
  if (raw === undefined || raw === '') return undefined;
  ctx.trustedMappingsUsed++;
  return raw;
}

function buildStatements(ctx: CaseContext): string[] {
  const ui = ctx
    .mapping.testMappings.find((m) => m.testCaseId === ctx.testCase.id)
    ?.ui;
  if (!ui) {
    recordBlock(ctx, 'MISSING_MAPPING', `No trusted UI execution mapping for test case '${ctx.testCase.id}'`);
    return [];
  }

  const statements: string[] = [];

  const steps = [...ui.stepMappings].sort((a, b) => a.stepOrder - b.stepOrder);
  for (const step of steps) {
    if (!SUPPORTED_GENERATOR_ACTIONS.has(step.action)) {
      recordBlock(
        ctx,
        'UNSUPPORTED_ACTION',
        `Action '${step.action}' cannot be materialized into deterministic Playwright source`,
        { stepOrder: step.stepOrder },
      );
      ctx.diagnostics.push({
        severity: 'info',
        message: `unsupported action counted: ${step.action}`,
        stepOrder: step.stepOrder,
      });
      continue;
    }

    if (step.action === 'navigate') {
      const url = buildNavigateUrl(ctx, step);
      if (!url) {
        recordBlock(ctx, 'MISSING_VALUE', `navigate requires a trusted route/URL`, {
          stepOrder: step.stepOrder,
        });
        continue;
      }
      statements.push(`await page.goto(${JSON.stringify(url)});`);
      continue;
    }

    const element = resolveElement(ctx, step.targetLogicalName, step.stepOrder);
    if (!element) continue;
    const loc = locatorExpression(element.locator);

    if (VALUE_REQUIRED_ACTIONS.has(step.action)) {
      const value = resolveFillValue(ctx, element, step);
      if (!value) {
        recordBlock(
          ctx,
          'MISSING_VALUE',
          `No trusted value for ${step.action} on '${step.targetLogicalName}'`,
          { stepOrder: step.stepOrder },
        );
        continue;
      }
      const method = step.action === 'select' ? 'selectOption' : 'fill';
      statements.push(`await ${loc}.${method}(${value});`);
      continue;
    }

    if (step.action === 'click') {
      statements.push(`await ${loc}.click();`);
    } else if (step.action === 'check') {
      statements.push(`await ${loc}.check();`);
    } else if (step.action === 'uncheck') {
      statements.push(`await ${loc}.uncheck();`);
    }
  }

  const assertions = [...ui.assertionMappings].sort(
    (a, b) => a.expectedResultIndex - b.expectedResultIndex,
  );
  for (const assertion of assertions) {
    if (UNMAPPABLE_ASSERTIONS.has(assertion.assertionType)) {
      recordBlock(
        ctx,
        'UNMAPPABLE_ASSERTION',
        `Assertion '${assertion.assertionType}' cannot be represented without a trusted attribute name`,
        { expectedResultIndex: assertion.expectedResultIndex },
      );
      continue;
    }

    const needsElement = !['url-equals', 'url-contains', 'page-title'].includes(
      assertion.assertionType,
    );
    let loc: string | undefined;
    if (needsElement) {
      const element = resolveElement(ctx, assertion.targetLogicalName, undefined, assertion.expectedResultIndex);
      if (!element) continue;
      loc = locatorExpression(element.locator);
    }

    if (VALUE_REQUIRED_ASSERTIONS.has(assertion.assertionType)) {
      const raw = resolveAssertionValue(ctx, assertion);
      if (raw === undefined) {
        recordBlock(
          ctx,
          'UNMAPPABLE_ASSERTION',
          `Assertion '${assertion.assertionType}' requires a trusted expected value that is not present`,
          { expectedResultIndex: assertion.expectedResultIndex },
        );
        continue;
      }
      statements.push(assertionStatement(assertion.assertionType, loc, raw));
      continue;
    }

    statements.push(assertionStatement(assertion.assertionType, loc, undefined));
  }

  return statements;
}

function assertionStatement(type: string, loc: string | undefined, raw: string | undefined): string {
  const target = loc ?? 'page';
  switch (type) {
    case 'visible':
      return `await expect(${target}).toBeVisible();`;
    case 'hidden':
      return `await expect(${target}).toBeHidden();`;
    case 'enabled':
      return `await expect(${target}).toBeEnabled();`;
    case 'disabled':
      return `await expect(${target}).toBeDisabled();`;
    case 'checked':
      return `await expect(${target}).toBeChecked();`;
    case 'unchecked':
      return `await expect(${target}).not.toBeChecked();`;
    case 'exists':
      return `await expect(${target}).toBeAttached();`;
    case 'not-exists':
      return `await expect(${target}).not.toBeAttached();`;
    case 'text-equals':
      return `await expect(${target}).toHaveText(${JSON.stringify(raw)});`;
    case 'text-contains':
      return `await expect(${target}).toContainText(${JSON.stringify(raw)});`;
    case 'value-equals':
      return `await expect(${target}).toHaveValue(${JSON.stringify(raw)});`;
    case 'url-equals':
      return `await expect(page).toHaveURL(${JSON.stringify(raw)});`;
    case 'url-contains':
      return `await expect(page).toHaveURL(/${escapeRegex(raw!)}/);`;
    case 'page-title':
      return `await expect(page).toHaveTitle(${JSON.stringify(raw)});`;
    case 'element-count':
      return `await expect(${target}).toHaveCount(${Number(raw)});`;
    default:
      throw new Error(`UNMAPPED_ASSERTION:${type}`);
  }
}

function buildSource(
  testCase: TestCase,
  statements: string[],
  artifactId: string,
  generationFingerprint: string,
): string {
  const indented = statements.map((s) => `  ${s}`).join('\n');
  return [
    '// ---------------------------------------------------------------------------',
    '// GENERATED BY TIRAI Phase 5.1 test-code-generator.',
    '// Trust model: every locator, action and assertion below is derived from the',
    '// trusted ExecutionMappingIR + UIElementCatalog. Generation used 0 AI calls and',
    '// guessed 0 selectors. This file is independently executable via:',
    '//   npx playwright test <this-file>',
    `// testCaseId: ${testCase.id}`,
    `// artifactId: ${artifactId}`,
    `// generationFingerprint: ${generationFingerprint}`,
    `// sourceFingerprint: __SOURCE_FINGERPRINT__`,
    '// ---------------------------------------------------------------------------',
    "import { test, expect } from '@playwright/test';",
    '',
    `test(${JSON.stringify(testCase.title)}, async ({ page }) => {`,
    indented,
    '});',
    '',
  ].join('\n');
}

// ---- Public entry --------------------------------------------------------

export async function generateE2ETests(
  input: TestCodeGenerationInput,
): Promise<TestCodeGenerationResult> {
  const { testCases, mapping, profile, options } = input;
  const framework = options.framework ?? 'playwright';
  const baseUrl = options.baseUrl ?? profile.ui?.environment.baseUrl ?? '';
  const catalog = indexCatalog(mapping.catalogs.uiCatalog ?? profile.ui?.catalog);

  const caseResults: TestCaseGenerationResult[] = [];
  const generatedFiles: string[] = [];
  let generatedBytes = 0;
  let trustedMappingsUsed = 0;
  let unsupportedActions = 0;
  let unmappableAssertions = 0;

  for (const testCase of testCases) {
    const ctx: CaseContext = {
      testCase,
      mapping,
      catalog,
      baseUrl,
      diagnostics: [],
      trustedMappingsUsed: 0,
    };

    // ---- Fail-closed gate: a TestCase must be fully, trustedly mapped (spec §9) ----
    const entry = mapping.testMappings.find((m) => m.testCaseId === testCase.id);
    if (!entry || !entry.ui || entry.status !== 'ready') {
      const unresolved = mapping.unresolved.filter((u) => u.testCaseId === testCase.id);
      const block = classifyMissingMapping(unresolved, entry);
      if (block.code === 'UNSUPPORTED_ACTION') unsupportedActions++;
      if (block.code === 'UNMAPPABLE_ASSERTION') unmappableAssertions++;
      trustedMappingsUsed += ctx.trustedMappingsUsed;
      const generationFingerprint = sha256({ testCase, mapping: entry, profile });
      caseResults.push({
        testCaseId: testCase.id,
        status: 'blocked',
        artifactId: artifactIdFrom(`${testCase.id}:blocked:${generationFingerprint}`),
        generationFingerprint,
        sourceFingerprint: sha256({ blocked: block.code }),
        blockingReason: block,
        diagnostics: [
          { severity: 'blocked', message: block.message },
          ...unresolved.map((u) => ({
            severity: 'blocked' as const,
            message: `unresolved[${u.stage}:${u.reason}]: ${u.description}`,
          })),
        ],
        trustedMappingsUsed: 0,
        guessedMappings: 0,
      });
      continue;
    }

    const statements = buildStatements(ctx);

    if (ctx.block) {
      if (ctx.block.code === 'UNSUPPORTED_ACTION') unsupportedActions++;
      if (ctx.block.code === 'UNMAPPABLE_ASSERTION') unmappableAssertions++;
      trustedMappingsUsed += ctx.trustedMappingsUsed;
      const generationFingerprint = sha256({
        testCase,
        mapping: mapping.testMappings.find((m) => m.testCaseId === testCase.id),
        profile,
      });
      caseResults.push({
        testCaseId: testCase.id,
        status: 'blocked',
        artifactId: artifactIdFrom(`${testCase.id}:blocked:${generationFingerprint}`),
        generationFingerprint,
        sourceFingerprint: sha256({ blocked: ctx.block.code }),
        blockingReason: ctx.block,
        diagnostics: ctx.diagnostics,
        trustedMappingsUsed: ctx.trustedMappingsUsed,
        guessedMappings: 0,
      });
      continue;
    }

    const generationFingerprint = sha256({
      testCase,
      mapping: mapping.testMappings.find((m) => m.testCaseId === testCase.id),
      profile,
    });
    const artifactId = artifactIdFrom(`${testCase.id}:${generationFingerprint}`);
    const rawSource = buildSource(
      testCase,
      statements,
      artifactId,
      generationFingerprint,
    );
    const formatted = await prettier.format(rawSource, { parser: 'typescript' });
    const sourceFingerprint = sha256(formatted);
    const finalSource = formatted.replace(
      '__SOURCE_FINGERPRINT__',
      sourceFingerprint,
    );

    const outPath = `${options.outputDir}/${sanitizeFileName(testCase.id)}.spec.ts`;
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, finalSource, 'utf8');

    trustedMappingsUsed += ctx.trustedMappingsUsed;
    generatedBytes += Buffer.byteLength(finalSource, 'utf8');
    generatedFiles.push(outPath);

    caseResults.push({
      testCaseId: testCase.id,
      status: 'generated',
      generatedFilePath: outPath,
      artifactId,
      generationFingerprint,
      sourceFingerprint,
      diagnostics: ctx.diagnostics,
      trustedMappingsUsed: ctx.trustedMappingsUsed,
      guessedMappings: 0,
    });
  }

  const blocked = caseResults.filter((c) => c.status === 'blocked').length;
  const generated = caseResults.filter((c) => c.status === 'generated').length;

  const metrics: GenerationMetrics = {
    testCasesReceived: testCases.length,
    testCasesGenerated: generated,
    testCasesBlocked: blocked,
    generatedFiles: generatedFiles.length,
    generatedBytes,
    generationAiCalls: 0,
    trustedMappingsUsed,
    guessedMappings: 0,
    unsupportedActions,
    unmappableAssertions,
    sourceSpecificBranchesInGenerator: 0,
  };

  const status: TestCodeGenerationResult['status'] =
    blocked === 0 ? 'success' : generated === 0 ? 'blocked' : 'partial';

  return {
    framework,
    status,
    generatedFiles,
    caseResults,
    metrics,
    fingerprint: sha256({ caseResults, metrics, framework }),
  };
}

/** Deterministic regeneration check used by acceptance matrix B (spec §45). */
export function generationFingerprintFor(
  input: TestCodeGenerationInput,
  testCaseId: string,
): string {
  const tc = input.testCases.find((t) => t.id === testCaseId);
  const m = input.mapping.testMappings.find((x) => x.testCaseId === testCaseId);
  return sha256({ testCase: tc, mapping: m, profile: input.profile });
}

export { stableStringify };
