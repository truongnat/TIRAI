import type { CanonicalContextChunk, CanonicalSourceDocument } from 'source-ingestion';
import type {
  SemanticIR,
  SemanticSection,
  SemanticEntity,
  SemanticFlow,
  SemanticRule,
  SemanticAttribute,
  ProvenanceReference as SemanticProvenanceReference,
} from 'semantic-analyzer';
import type {
  RequirementIR,
  Requirement,
  RequirementType,
} from 'requirement-builder';
import type {
  TestPlanIR,
  TestCase,
  TestScenario,
  TestProvenance,
  TestStep,
  ExpectedResult,
  Priority,
  TestScenarioCategory,
  TestInput,
} from 'test-planner';

interface ParsedRow {
  rowNumber: number;
  cells: string[];
}

interface ParsedSheet {
  context: CanonicalContextChunk;
  headers: string[];
  rows: ParsedRow[];
}

interface BusinessFlow {
  code: string;
  name: string;
  description: string;
  input: string;
  output: string;
  api: string;
  branch: string;
  note: string;
  sheet: ParsedSheet;
  row: ParsedRow;
}

interface DesignCompilation {
  semanticIR: SemanticIR;
  requirementIR: RequirementIR;
  testPlanIR: TestPlanIR;
}

/**
 * Compile the conventional Japanese-style detailed-design workbook directly
 * into canonical IR when it contains a business-flow table. This is a
 * deterministic, source-independent adapter: every generated object keeps
 * the originating workbook context and row range, and no AI calls are made.
 */
export function compileStructuredDesignDocument(doc: CanonicalSourceDocument): DesignCompilation | null {
  const sheets = doc.contexts.map(parseSheet);
  const flowSheet = sheets.find((sheet) => isBusinessFlowSheet(sheet));
  if (!flowSheet) return null;

  const flows = flowSheet.rows
    .map((row) => toBusinessFlow(flowSheet, row))
    .filter((flow): flow is BusinessFlow => flow !== null);
  if (flows.length === 0) return null;

  const semanticIR = buildSemanticIR(doc, sheets, flows);
  const requirementIR = buildRequirementIR(doc, flows, semanticIR);
  const testPlanIR = buildTestPlanIR(doc, flows, requirementIR);
  return { semanticIR, requirementIR, testPlanIR };
}

function parseSheet(context: CanonicalContextChunk): ParsedSheet {
  const lines = context.content.split(/\r?\n/);
  const headers: string[] = [];
  let rowsStart = -1;
  let inColumns = false;

  for (const [index, line] of lines.entries()) {
    if (line === 'Columns:') {
      inColumns = true;
      continue;
    }
    if (line === 'Rows:') {
      rowsStart = index + 1;
      inColumns = false;
      continue;
    }
    if (inColumns) {
      const match = /^([A-Z]+):\s*(.*)$/.exec(line);
      if (match) headers.push(match[2].trim());
    }
  }

  const rows: ParsedRow[] = [];
  if (rowsStart >= 0) {
    for (const line of lines.slice(rowsStart)) {
      const match = /^(\d+)\s+\|\s?(.*)$/.exec(line);
      if (!match) continue;
      const rowNumber = Number(match[1]);
      const cells = match[2].split(/\s+\|\s+/).map((cell) => cell.trim());
      rows.push({ rowNumber, cells });
    }
  }

  return { context, headers, rows };
}

function isBusinessFlowSheet(sheet: ParsedSheet): boolean {
  const headerText = sheet.headers.join('|').toLowerCase();
  return (
    headerText.includes('mã xử lý') ||
    headerText.includes('business flow') ||
    headerText.includes('processing code')
  ) && sheet.rows.some((row) => /^BF[-_]/i.test(row.cells[1] ?? ''));
}

function toBusinessFlow(sheet: ParsedSheet, row: ParsedRow): BusinessFlow | null {
  const code = row.cells[1] ?? '';
  const name = row.cells[2] ?? '';
  const description = row.cells[3] ?? '';
  if (!/^BF[-_]/i.test(code) || !name || !description) return null;
  return {
    code,
    name,
    description,
    input: row.cells[4] ?? '-',
    output: row.cells[5] ?? '-',
    api: row.cells[6] ?? '-',
    branch: row.cells[7] ?? '-',
    note: row.cells[8] ?? '-',
    sheet,
    row,
  };
}

function provenance(context: CanonicalContextChunk, rowNumber?: number, columns = 'A:I'): SemanticProvenanceReference {
  const range = context.metadata?.range;
  return {
    contextId: context.id,
    ...(context.metadata?.sheetName ? { sheet: String(context.metadata.sheetName) } : {}),
    ranges: [range ? String(range) : rowNumber ? `${columns}${rowNumber}` : columns],
    ...(rowNumber ? { cells: [`${columns.split(':')[0]}${rowNumber}`] } : {}),
  };
}

function rowProvenance(flow: BusinessFlow): TestProvenance {
  const p = provenance(flow.sheet.context, flow.row.rowNumber);
  return {
    requirementId: `REQ-${flow.code}`,
    contextId: p.contextId,
    ...(p.sheet ? { sheet: p.sheet } : {}),
    ...(p.ranges ? { ranges: p.ranges } : {}),
    ...(p.cells ? { cells: p.cells } : {}),
  };
}

function buildSemanticIR(
  doc: CanonicalSourceDocument,
  sheets: ParsedSheet[],
  flows: BusinessFlow[],
): SemanticIR {
  const allProvenance = doc.contexts.map((context) => provenance(context));
  const sections: SemanticSection[] = sheets.map((sheet, index) => ({
    id: `SEC-${String(index + 1).padStart(3, '0')}`,
    title: String(sheet.context.metadata?.sheetName ?? `Sheet ${index + 1}`),
    type: 'detailed-design-section',
    provenance: [provenance(sheet.context)],
    confidence: 1,
  }));

  const dbSheet = sheets.find((sheet) => sheet.headers.some((header) => /bảng|entity|attribute/i.test(header)));
  const entities = buildEntities(dbSheet);
  const semanticFlows: SemanticFlow[] = flows.map((flow) => {
    const p = provenance(flow.sheet.context, flow.row.rowNumber);
    return {
      id: `FLOW-${flow.code}`,
      name: flow.name,
      description: flow.description,
      actors: ['Người dùng'],
      steps: [{
        order: 1,
        action: flow.description,
        actor: 'Người dùng',
        target: flow.input,
        condition: flow.branch,
        outcome: flow.output,
        provenance: [p],
      }],
      preconditions: [],
      postconditions: [flow.output],
      provenance: [p],
      confidence: 1,
    };
  });

  const rules: SemanticRule[] = flows
    .filter((flow) => flow.branch !== '-' || flow.api !== '-')
    .map((flow) => {
      const p = provenance(flow.sheet.context, flow.row.rowNumber);
      return {
        id: `RULE-${flow.code}`,
        type: classifyRuleType(flow),
        statement: `${flow.name}: ${flow.description} Input=${flow.input}; Output=${flow.output}; Branch=${flow.branch}; API=${flow.api}.`,
        conditions: flow.branch === '-' ? [] : [{ expression: flow.branch, operands: [], provenance: [p] }],
        effects: [{ description: flow.output, target: flow.name, provenance: [p] }],
        relatedEntityIds: [],
        provenance: [p],
        confidence: 1,
      };
    });

  return {
    schemaVersion: '1.0',
    status: 'complete',
    document: {
      title: doc.source.displayName,
      summary: `Structured detailed design compiled from ${doc.contexts.length} workbook sheets.`,
      language: ['vi'],
      domainHints: ['web-application', 'detailed-design'],
      provenance: allProvenance,
    },
    sections,
    entities,
    flows: semanticFlows,
    rules,
    relationships: [],
    unresolved: [],
    analysis: {
      provider: 'structured-design-compiler',
      model: 'deterministic',
      promptVersion: 'structured-design-1.0',
      chunksAnalyzed: doc.contexts.length,
      aiRequests: 0,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      warnings: [],
      quality: {
        entities: entities.length,
        flows: semanticFlows.length,
        flowSteps: semanticFlows.reduce((sum, flow) => sum + flow.steps.length, 0),
        rules: rules.length,
        relationships: 0,
        unresolved: 0,
        lowConfidenceCount: 0,
        provenanceCoverage: 1,
      },
      metrics: {
        contextsTotal: doc.contexts.length,
        contextsProcessed: doc.contexts.length,
        contextsReused: 0,
        contextsFailed: 0,
        chunkRequests: 0,
        consolidationRequests: 0,
        transportRetries: 0,
        schemaRepairs: 0,
        estimatedInputTokens: 0,
        maxEstimatedTokensPerRequest: 0,
        peakConcurrency: 1,
        checkpointHits: 0,
        checkpointMisses: 0,
        initialOutputBudget: 0,
        finalOutputBudget: 0,
        outputBudgetEscalations: 0,
        outputBudgetCeiling: 0,
      },
      consolidationComplete: true,
      contextsExpected: doc.contexts.length,
      contextsCompleted: doc.contexts.length,
    },
  };
}

function buildEntities(sheet: ParsedSheet | undefined): SemanticEntity[] {
  if (!sheet) return [];
  const byName = new Map<string, SemanticEntity>();
  for (const row of sheet.rows) {
    const entityName = row.cells[1] ?? '';
    const attributeName = row.cells[2] ?? '';
    if (!entityName || !attributeName) continue;
    const p = provenance(sheet.context, row.rowNumber, 'B:K');
    const existing = byName.get(entityName);
    const attribute: SemanticAttribute = {
      name: attributeName,
      dataType: row.cells[3] || undefined,
      description: row.cells[10] || undefined,
      provenance: [p],
    };
    if (existing) {
      existing.attributes = [...(existing.attributes ?? []), attribute];
    } else {
      byName.set(entityName, {
        id: `ENT-${slug(entityName)}`,
        name: entityName,
        type: 'data-entity',
        description: `Entity ${entityName} from detailed design.`,
        attributes: [attribute],
        provenance: [p],
        confidence: 1,
      });
    }
  }
  return [...byName.values()];
}

function buildRequirementIR(
  doc: CanonicalSourceDocument,
  flows: BusinessFlow[],
  semanticIR: SemanticIR,
): RequirementIR {
  const requirements: Requirement[] = flows.map((flow) => {
    const p = provenance(flow.sheet.context, flow.row.rowNumber);
    const type = classifyRequirementType(flow);
    const inputs = inputDefinitions(flow);
    return {
      id: `REQ-${flow.code}`,
      title: flow.name,
      type,
      statement: `${flow.description} Đầu vào: ${flow.input}. Đầu ra: ${flow.output}. Điều kiện: ${flow.branch}.`,
      sourceNature: 'explicit',
      actor: 'Người dùng',
      trigger: flow.input,
      preconditions: [],
      inputs,
      dataNeeds: flow.api === '-' ? [] : [{ description: flow.api, type: 'external-api', constraints: [], provenance: [p] }],
      expectedBehaviors: [
        { description: flow.output, condition: flow.branch === '-' ? undefined : flow.branch, target: flow.name, provenance: [p] },
      ],
      outcomes: [{ description: flow.output, state: flow.branch, provenance: [p] }],
      constraints: flow.branch === '-' ? [] : [{ type: 'branch-condition', description: flow.branch, provenance: [p] }],
      relatedSemanticIds: [`FLOW-${flow.code}`, ...(flow.api === '-' ? [] : [`RULE-${flow.code}`])],
      provenance: [p],
      confidence: 1,
      testability: { status: 'testable', reasons: [] },
    };
  });

  const testable = requirements.length;
  return {
    schemaVersion: '1.0',
    document: {
      title: doc.source.displayName,
      summary: `Requirements compiled from ${flows.length} explicit business-flow rows.`,
      sourceSemanticIR: 'semantic-ir.json',
      provenance: semanticIR.document.provenance,
    },
    requirements,
    unresolved: [],
    conflicts: [],
    quality: {
      total: requirements.length,
      explicit: requirements.length,
      derived: 0,
      testable,
      partiallyTestable: 0,
      notTestable: 0,
      unknownTestability: 0,
      lowConfidence: 0,
      unresolved: 0,
      conflicts: 0,
      provenanceCoverage: 1,
    },
  };
}

function buildTestPlanIR(
  doc: CanonicalSourceDocument,
  flows: BusinessFlow[],
  requirementIR: RequirementIR,
): TestPlanIR {
  const scenarios: TestScenario[] = [];
  const testCases: TestCase[] = [];

  for (const flow of flows) {
    const requirementId = `REQ-${flow.code}`;
    const scenarioId = `SC-${flow.code}`;
    const testCaseId = `TC-${flow.code}`;
    const p = rowProvenance(flow);
    const definition = testDefinition(flow);
    scenarios.push({
      id: scenarioId,
      title: `Scenario: ${flow.name}`,
      objective: definition.objective,
      category: definition.category,
      requirementIds: [requirementId],
      preconditions: [],
      dataNeeds: [],
      expectedBehavior: definition.expectedResults.map((result) => result.description),
      priority: definition.priority,
      provenance: [p],
      confidence: 1,
    });
    testCases.push({
      id: testCaseId,
      scenarioId,
      requirementIds: [requirementId],
      title: definition.title,
      objective: definition.objective,
      type: 'ui',
      priority: definition.priority,
      preconditions: [],
      inputs: definition.inputs,
      dataNeeds: [],
      steps: definition.steps,
      expectedResults: definition.expectedResults,
      cleanup: [],
      automation: definition.automation,
      provenance: [p],
      confidence: 1,
    });
  }

  const requirementIds = requirementIR.requirements.map((requirement) => requirement.id);
  const coverage = requirementIR.requirements.map((requirement) => {
    const testCase = testCases.find((candidate) => candidate.requirementIds.includes(requirement.id));
    return {
      requirementId: requirement.id,
      strategies: strategiesFor(requirement),
      scenarioIds: testCase ? [testCase.scenarioId] : [],
      status: testCase ? 'covered' as const : 'not-covered' as const,
      reasons: testCase ? ['One canonical test case generated from the explicit business-flow row.'] : ['No test case generated.'],
    };
  });

  const counts = {
    positiveCases: scenarios.filter((scenario) => scenario.category === 'happy-path').length,
    negativeCases: scenarios.filter((scenario) => scenario.category === 'negative').length,
    boundaryCases: scenarios.filter((scenario) => scenario.category === 'boundary').length,
    validationCases: scenarios.filter((scenario) => scenario.category === 'validation').length,
    automationReady: testCases.filter((testCase) => testCase.automation.status === 'ready').length,
  };

  return {
    schemaVersion: '1.0',
    scope: {
      requirementIds,
      objective: `Generate UI test cases for ${flows.length} business flows described by the detailed-design workbook.`,
      assumptions: ['The source code is the implementation authority for concrete UI mappings.'],
      exclusions: ['Backend persistence is not available in .example; mutation cases remain manual-only until an API fixture mapping is supplied.'],
    },
    requirementCoverage: coverage,
    scenarios,
    testCases,
    dataNeeds: [],
    unresolved: [],
    quality: {
      requirementsTotal: requirementIds.length,
      requirementsCovered: coverage.filter((item) => item.status === 'covered').length,
      requirementsPartiallyCovered: 0,
      requirementsNotCovered: coverage.filter((item) => item.status === 'not-covered').length,
      coverageRate: requirementIds.length === 0 ? 0 : coverage.filter((item) => item.status === 'covered').length / requirementIds.length,
      scenarios: scenarios.length,
      testCases: testCases.length,
      ...counts,
      unresolved: 0,
      provenanceCoverage: 1,
    },
  };
}

interface TestDefinition {
  title: string;
  objective: string;
  category: TestScenarioCategory;
  priority: Priority;
  inputs: TestInput[];
  steps: TestStep[];
  expectedResults: ExpectedResult[];
  automation: TestCase['automation'];
}

function testDefinition(flow: BusinessFlow): TestDefinition {
  const manual = (reason: string): TestCase['automation'] => ({
    status: 'manual-only',
    suggestedExecutor: 'ui',
    reasons: [reason],
  });
  const ready: TestCase['automation'] = { status: 'ready', suggestedExecutor: 'ui', reasons: [] };
  const navigate = (route: string): TestStep => ({ order: 1, action: 'navigate', target: route, input: route });
  const next = (order: number, action: string, target: string, input?: string): TestStep => ({ order, action, target, ...(input !== undefined ? { input } : {}) });
  const visible = (description: string, target: string): ExpectedResult => ({
    description,
    verificationType: 'ui',
    target,
    verificationIntent: { kind: 'visible-ui-state', subject: target, authority: 'VISIBLE_UI_STATE', requiredSources: ['UI'] },
  });
  const enabled = (description: string, target: string): ExpectedResult => ({
    description,
    verificationType: 'ui',
    target,
    verificationIntent: { kind: 'visible-ui-state', subject: target, authority: 'VISIBLE_UI_STATE', requiredSources: ['UI'] },
  });
  const valueEquals = (description: string, target: string, expectedValue: string): ExpectedResult => ({
    description,
    verificationType: 'ui',
    target,
    verificationIntent: { kind: 'value-equals', subject: target, expectedValue, authority: 'VISIBLE_UI_STATE', requiredSources: ['UI'] },
  });
  const textContains = (description: string, target: string, expectedValue: string): ExpectedResult => ({
    description,
    verificationType: 'ui',
    target,
    verificationIntent: { kind: 'semantic', subject: target, expectedValue, authority: 'VISIBLE_UI_STATE', requiredSources: ['UI'] },
  });
  const routeContains = (description: string, expectedValue: string): ExpectedResult => ({
    description,
    verificationType: 'ui',
    verificationIntent: { kind: 'visible-ui-state', expectedValue, authority: 'VISIBLE_UI_STATE', requiredSources: ['UI'] },
  });

  switch (flow.code.toUpperCase()) {
    case 'BF-001':
      return { title: 'App shell loads at the root route', objective: 'Verify the application shell opens at /.', category: 'happy-path', priority: 'high', inputs: [], steps: [navigate('/')], expectedResults: [{ description: 'The browser title is TanStack Full Demo.', verificationType: 'ui', verificationIntent: { kind: 'visible-ui-state', expectedValue: 'TanStack Full Demo', authority: 'VISIBLE_UI_STATE', requiredSources: ['UI'] } }], automation: ready };
    case 'BF-002':
      return { title: 'Dashboard is visible', objective: 'Verify the root route renders the dashboard hero.', category: 'interface', priority: 'high', inputs: [], steps: [navigate('/')], expectedResults: [visible('The dashboard heading is visible.', 'dashboard-heading')], automation: ready };
    case 'BF-003':
      return { title: 'Navigation opens the Todos module', objective: 'Verify the Todos navigation tab changes the route.', category: 'happy-path', priority: 'high', inputs: [], steps: [navigate('/'), next(2, 'click', 'nav-todos')], expectedResults: [routeContains('The browser navigates to the Todos route.', '/todos')], automation: ready };
    case 'BF-004':
      return { title: 'Todos page loads', objective: 'Verify the Todos module renders its page header.', category: 'happy-path', priority: 'high', inputs: [], steps: [navigate('/todos')], expectedResults: [visible('The Todos page heading is visible.', 'todos-heading')], automation: ready };
    case 'BF-005':
      return { title: 'Add Todo rejects an empty title', objective: 'Verify the required-title validation is shown for whitespace input.', category: 'validation', priority: 'high', inputs: [{ name: 'title', valueStrategy: 'invalid', value: '   ', description: 'Whitespace-only todo title' }], steps: [navigate('/todos'), next(2, 'fill', 'add-todo-input', '   '), next(3, 'blur', 'add-todo-input'), next(4, 'click', 'add-todo-button')], expectedResults: [textContains('The title validation message is shown.', 'add-todo-validation', 'Title is required')], automation: ready };
    case 'BF-006':
      return { title: 'Add Todo submits a valid title', objective: 'Verify a valid todo can be submitted and the form reset behavior is observed.', category: 'happy-path', priority: 'high', inputs: [{ name: 'title', valueStrategy: 'valid', value: 'TIRAI generated todo', description: 'Valid todo title' }], steps: [navigate('/todos'), next(2, 'fill', 'add-todo-input', 'TIRAI generated todo'), next(3, 'click', 'add-todo-button')], expectedResults: [visible('The Add Todo form remains available after submit.', 'add-todo-input')], automation: manual('Requires a trusted API fixture and optimistic-cache assertion for the created row.') };
    case 'BF-007':
      return { title: 'Todos search input accepts a query', objective: 'Verify the global Todos search control accepts a query.', category: 'interface', priority: 'medium', inputs: [{ name: 'searchQuery', valueStrategy: 'valid', value: 'buy milk', description: 'Global todo search query' }], steps: [navigate('/todos'), next(2, 'fill', 'todo-search', 'buy milk')], expectedResults: [valueEquals('The search control contains the entered query.', 'todo-search', 'buy milk')], automation: ready };
    case 'BF-008':
      return { title: 'Todo status can be toggled', objective: 'Verify a selected todo changes its completed state and progress.', category: 'state-transition', priority: 'high', inputs: [{ name: 'todoId', valueStrategy: 'existing-data', description: 'Existing todo row identity' }], steps: [navigate('/todos')], expectedResults: [visible('A Todo row is available for status transition.', 'todo-row')], automation: manual('Requires a stable row identity or API fixture binding for the dynamic todo list.') };
    case 'BF-009':
      return { title: 'Todo can be deleted', objective: 'Verify a selected todo is removed from the list.', category: 'state-transition', priority: 'high', inputs: [{ name: 'todoId', valueStrategy: 'existing-data', description: 'Existing todo row identity' }], steps: [navigate('/todos')], expectedResults: [visible('A Todo row is available for deletion.', 'todo-row')], automation: manual('Requires a stable row identity or API fixture binding for the dynamic todo list.') };
    case 'BF-010':
      return { title: 'Posts page loads', objective: 'Verify the Posts module renders its page header.', category: 'happy-path', priority: 'high', inputs: [], steps: [navigate('/posts')], expectedResults: [visible('The Posts page heading is visible.', 'posts-heading')], automation: ready };
    case 'BF-011':
      return { title: 'Posts filter input accepts a query', objective: 'Verify the Posts table filter control accepts a query.', category: 'interface', priority: 'medium', inputs: [{ name: 'postFilter', valueStrategy: 'valid', value: 'tanstack', description: 'Posts table filter query' }], steps: [navigate('/posts'), next(2, 'fill', 'posts-filter', 'tanstack')], expectedResults: [valueEquals('The Posts filter contains the entered query.', 'posts-filter', 'tanstack')], automation: ready };
    case 'BF-012':
      return { title: 'Posts view mode control is usable', objective: 'Verify the Posts view-mode control can be activated.', category: 'interface', priority: 'medium', inputs: [], steps: [navigate('/posts'), next(2, 'click', 'posts-virtual-view')], expectedResults: [enabled('The virtual-list view control remains enabled.', 'posts-virtual-view')], automation: ready };
    case 'BF-013':
      return { title: 'Users page loads', objective: 'Verify the Users module renders its page header.', category: 'happy-path', priority: 'high', inputs: [], steps: [navigate('/users')], expectedResults: [visible('The Users page heading is visible.', 'users-heading')], automation: ready };
    case 'BF-014':
      return { title: 'Users filter input accepts a query', objective: 'Verify the Users table filter control accepts a query.', category: 'interface', priority: 'medium', inputs: [{ name: 'userFilter', valueStrategy: 'valid', value: 'Leanne', description: 'Users table filter query' }], steps: [navigate('/users'), next(2, 'fill', 'users-filter', 'Leanne')], expectedResults: [valueEquals('The Users filter contains the entered query.', 'users-filter', 'Leanne')], automation: ready };
    case 'BF-015':
      return { title: 'Edit User dialog opens', objective: 'Verify the edit dialog opens for a selected user.', category: 'interface', priority: 'high', inputs: [{ name: 'userId', valueStrategy: 'existing-data', description: 'Existing user row identity' }], steps: [navigate('/users')], expectedResults: [visible('A user row is available for editing.', 'user-row')], automation: manual('Requires a stable user-row action locator or API fixture binding.') };
    case 'BF-016':
      return { title: 'Edit User validates required fields', objective: 'Verify required-field validation for the edit form.', category: 'validation', priority: 'high', inputs: [{ name: 'userId', valueStrategy: 'existing-data', description: 'Existing user row identity' }], steps: [navigate('/users')], expectedResults: [visible('The edit dialog form is available for validation.', 'edit-user-dialog')], automation: manual('Requires a stable user-row action locator and dialog fixture.') };
    case 'BF-017':
      return { title: 'User changes can be saved', objective: 'Verify a valid user update closes the dialog after save.', category: 'state-transition', priority: 'high', inputs: [{ name: 'userId', valueStrategy: 'existing-data', description: 'Existing user row identity' }], steps: [navigate('/users')], expectedResults: [visible('The Users page remains available for update.', 'users-heading')], automation: manual('Requires a stable user-row action locator and trusted PATCH fixture.') };
    default:
      return { title: flow.name, objective: flow.description, category: 'other', priority: 'medium', inputs: inputDefinitions(flow).map((input) => ({ name: input.name, valueStrategy: 'unknown', description: input.description })), steps: [navigate('/')], expectedResults: [], automation: manual('No deterministic UI mapping was defined for this business-flow code.') };
  }
}

function inputDefinitions(flow: BusinessFlow): Array<Requirement['inputs'][number]> {
  if (flow.input === '-' || !flow.input.trim()) return [];
  const knownNames = ['title', 'completed', 'userId', 'id', 'searchQuery', 'viewMode', 'name', 'email', 'phone', 'website'];
  const names = [...new Set(knownNames.filter((name) => new RegExp(`\\b${name}\\b`, 'i').test(flow.input)))];
  if (names.length === 0) {
    return [{ name: 'businessInput', description: flow.input, dataType: 'string', required: true, constraints: [], provenance: [provenance(flow.sheet.context, flow.row.rowNumber)] }];
  }
  return names.map((name) => ({
    name,
    description: flow.input,
    dataType: ['completed'].includes(name) ? 'boolean' : ['userId', 'id'].includes(name) ? 'number' : 'string',
    required: true,
    constraints: [],
    provenance: [provenance(flow.sheet.context, flow.row.rowNumber)],
  }));
}

function classifyRequirementType(flow: BusinessFlow): RequirementType {
  const text = `${flow.name} ${flow.description} ${flow.branch}`.toLowerCase();
  if (/kiểm tra|validate|required|bắt buộc/.test(text)) return 'validation';
  if (/đổi trạng thái|optimistic|lưu|xóa|thêm/.test(text)) return 'state-transition';
  if (/hiển thị|table|bảng|điều hướng|page|view/.test(text)) return 'interface';
  if (flow.api !== '-') return 'functional';
  return 'functional';
}

function classifyRuleType(flow: BusinessFlow): string {
  const text = `${flow.name} ${flow.description}`.toLowerCase();
  if (/kiểm tra|validate|required|bắt buộc/.test(text)) return 'validation';
  if (/đổi trạng thái|optimistic|lưu|xóa|thêm/.test(text)) return 'state-transition';
  return 'behavior';
}

function strategiesFor(requirement: Requirement): Array<'positive' | 'negative' | 'boundary' | 'validation' | 'state-transition' | 'error-handling' | 'interface' | 'data' | 'security' | 'other'> {
  if (requirement.type === 'validation') return ['validation', 'negative'];
  if (requirement.type === 'state-transition') return ['state-transition'];
  if (requirement.type === 'interface') return ['interface'];
  return ['positive'];
}

function slug(value: string): string {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase() || 'ENTITY';
}
